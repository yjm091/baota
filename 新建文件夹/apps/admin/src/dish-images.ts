export const dishImages: Record<string, string> = Object.fromEntries(Object.entries({
  '红烧肉': 'hong-shao-rou',
  '清蒸鲈鱼': 'qing-zheng-lu-yu',
  '拍黄瓜': 'pai-huang-gua',
  '酸梅汤': 'suan-mei-tang',
  '柠檬茶': 'ning-meng-cha',
  '鲜榨橙汁': 'xian-zha-cheng-zhi'
}).map(([name, file]) => [name, `${import.meta.env.BASE_URL}dish-images/${file}.jpg`]))
