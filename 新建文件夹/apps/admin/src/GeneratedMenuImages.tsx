import { useState } from 'react'
import { call, mockMode, uploadImage } from './api'
import { dishImages } from './dish-images'
import type { Dish } from './types'

export function GeneratedMenuImages({ onComplete }: { onComplete: () => Promise<void> }) {
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  async function replaceImages() {
    setRunning(true)
    try {
      const menu = await call<{ dishes: Dish[] }>('menu')
      const matched = menu.dishes.filter(dish => dishImages[dish.name])
      if (!matched.length) throw new Error('当前菜单没有匹配的菜名')
      let completed = 0
      for (const dish of matched) {
        setMessage(`正在更新 ${dish.name}（${completed + 1}/${matched.length}）`)
        const response = await fetch(dishImages[dish.name])
        if (!response.ok) throw new Error(`${dish.name}图片文件读取失败`)
        const blob = await response.blob()
        if (blob.type !== 'image/jpeg') throw new Error(`${dish.name}图片格式不正确`)
        const file = new File([blob], 'dish.jpg', { type: 'image/jpeg' })
        const uploaded = await uploadImage(file)
        try {
          await call('dish.save', { ...dish, imageFileId: uploaded.fileID, imageUrl: mockMode ? uploaded.url : undefined })
        } finally {
          if (uploaded.url.startsWith('blob:')) URL.revokeObjectURL(uploaded.url)
        }
        completed++
      }
      setMessage(`已更新 ${completed} 道菜品图片${mockMode ? '（本地演示）' : '至云存储，小程序和管理端共用'}`)
      await onComplete()
    } catch (error) {
      setMessage((error as Error).message || '图片更新失败，可重新尝试')
    } finally { setRunning(false) }
  }
  return <div className="menu-toolbar"><button className="button outline" disabled={running} onClick={() => void replaceImages()}>{running ? '更新图片中…' : '应用生成的菜品图片'}</button><span role="status">{message}</span></div>
}
