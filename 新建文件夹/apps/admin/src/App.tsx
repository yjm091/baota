import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowRight, ChefHat, CircleDollarSign, ClipboardList, LogOut, Plus, RefreshCw, Search, Settings2, Store, Utensils, X } from 'lucide-react'
import { call, clearSession, currentStaff, mockMode, saveSession, uploadImage } from './api'
import type { Category, Dish, Order, Overview, Role, Staff, Table } from './types'
import { GeneratedMenuImages } from './GeneratedMenuImages'

const roleLabels: Record<Role, string> = { admin: '管理员', frontdesk: '前台', kitchen: '后厨' }
const statusLabels: Record<string, string> = { pending: '待前台确认', confirmed: '待后厨开始', preparing: '制作中', ready: '待上桌', served: '已上齐', paid: '已付款', canceled: '已取消' }
type Tab = 'overview' | 'orders' | 'menu' | 'tables' | 'kitchen'

// ===== 可选的三个员工账号 =====
const staffAccounts: { username: string; role: Role; password: string }[] = [
  { username: 'admin', role: 'admin', password: 'ChangeMe123!' },
  { username: 'frontdesk', role: 'frontdesk', password: 'ChangeMe123!' },
  { username: 'kitchen', role: 'kitchen', password: 'ChangeMe123!' },
]

export default function App() {
  const [staff, setStaff] = useState<Staff | null>(currentStaff())
  const [tab, setTab] = useState<Tab>(staff?.role === 'kitchen' ? 'kitchen' : staff?.role === 'frontdesk' ? 'orders' : 'overview')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [tables, setTables] = useState<Table[]>([])
  const [kitchenOrders, setKitchenOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'dish' | 'category' | 'table' | 'password' | null>(null)
  const [editingDish, setEditingDish] = useState<Dish | null>(null)
  const [filter, setFilter] = useState('')

  const refresh = useCallback(async () => {
    if (!staff) return
    setLoading(true); setError('')
    try {
      if (staff.role === 'admin' || staff.role === 'frontdesk') {
        const now = new Date()
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        const data = await call<Overview>('admin.overview', { dayStart: dayStart.toISOString(), dayEnd: dayEnd.toISOString() })
        setOverview(data)
        if (staff.role === 'admin') setTables(await call<Table[]>('table.list'))
      }
      if (staff.role === 'kitchen') setKitchenOrders(await call<Order[]>('kitchen.list'))
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [staff])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (staff?.mustChangePassword) setModal('password') }, [staff])
  useEffect(() => {
    if (!staff) return
    const timer = window.setInterval(() => { void refresh() }, 8000)
    return () => window.clearInterval(timer)
  }, [refresh, staff])

  const tabs = useMemo(() => {
    if (staff?.role === 'kitchen') return [{ id: 'kitchen' as Tab, label: '后厨看板', icon: ChefHat }]
    if (staff?.role === 'frontdesk') return [{ id: 'orders' as Tab, label: '订单与结账', icon: ClipboardList }]
    return [{ id: 'overview' as Tab, label: '经营概览', icon: Activity }, { id: 'orders' as Tab, label: '订单与结账', icon: ClipboardList }, { id: 'menu' as Tab, label: '菜单管理', icon: Utensils }, { id: 'tables' as Tab, label: '桌台管理', icon: Store }]
  }, [staff])

  async function login(username: string, password: string) {
    setError('')
    try {
      let result: { token: string; staff: Staff }
      try {
        result = await call('auth.login', { username, password })
      } catch (error) {
        const message = (error as Error).message || ''
        const missingStaffCollection = /db or table not exist:\s*staff|staff.*(?:collection_not_exist|not exist|不存在)/i.test(message)
        const invalidAdminCredentials = /账号或密码错误/.test(message)
        if (mockMode || username.trim() !== 'admin' || (!missingStaffCollection && !invalidAdminCredentials)) throw error

        try {
          await call('admin.bootstrap', { password })
        } catch (bootstrapError) {
          if (/初始化口令无效/.test((bootstrapError as Error).message || '')) throw error
          throw bootstrapError
        }
        result = await call('auth.login', { username, password })
      }
      saveSession(result.token, result.staff)
      setStaff(result.staff)
      setTab(result.staff.role === 'kitchen' ? 'kitchen' : result.staff.role === 'frontdesk' ? 'orders' : 'overview')
    } catch (e) { setError((e as Error).message) }
  }
  function logout() { clearSession(); setStaff(null); setOverview(null) }
  async function action(name: string, payload: any = {}) { try { setError(''); await call(name, payload); await refresh() } catch (e) { setError((e as Error).message) } }
  async function createTable(name: string) { try { await call('table.create', { name }); setTables(await call<Table[]>('table.list')); setModal(null) } catch (e) { setError((e as Error).message) } }

  if (!staff) return <Login onLogin={login} error={error} />
  const title = tabs.find(item => item.id === tab)?.label || '工作台'
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Utensils size={20} /></div><div><strong>小满餐厅</strong><small>OPERATIONS</small></div></div>
      <div className="side-label">工作空间</div>
      <nav>{tabs.map(item => <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><item.icon size={18} /><span>{item.label}</span>{item.id === 'orders' && overview?.openOrders ? <b className="nav-count">{overview.openOrders}</b> : null}</button>)}</nav>
      <div className="side-bottom"><div className="mini-status"><span className="status-dot" /> 系统运行正常</div><div className="profile"><div className="avatar">{staff.username.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{staff.username}</strong><small>{roleLabels[staff.role]}</small></div><button className="icon-button" title="退出登录" onClick={logout}><LogOut size={17} /></button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><div className="breadcrumb">餐厅运营 <span>/</span> {title}</div><h1>{title}</h1></div><div className="top-actions"><span className={`mode-pill ${mockMode ? 'demo' : ''}`}><i />{mockMode ? '本地演示数据' : 'CloudBase 已连接'}</span><button className="button quiet" onClick={() => setModal('password')}><Settings2 size={16} /> 修改密码</button><button className="icon-button refresh" onClick={() => void refresh()} title="刷新"><RefreshCw size={17} className={loading ? 'spin' : ''} /></button></div></header>
      {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
      <div className="content">
        {tab === 'menu' && staff.role === 'admin' && <GeneratedMenuImages onComplete={refresh} />}
        {tab === 'overview' && staff.role === 'admin' && <OverviewView data={overview} onNavigate={setTab} />}
        {tab === 'orders' && (staff.role === 'admin' || staff.role === 'frontdesk') && <OrdersView overview={overview} onAction={action} canServe={staff.role === 'frontdesk'} />}
        {tab === 'kitchen' && staff.role === 'kitchen' && <KitchenView orders={kitchenOrders} onAction={action} />}
        {tab === 'menu' && staff.role === 'admin' && <MenuView overview={overview} filter={filter} setFilter={setFilter} onAdd={() => { setEditingDish(null); setModal('dish') }} onEdit={(dish) => { setEditingDish(dish); setModal('dish') }} onAvailability={(dish) => void action('dish.setAvailability', { id: dish.id, active: dish.active, soldOut: !dish.soldOut })} onPublish={(dish) => void action('dish.setAvailability', { id: dish.id, active: !dish.active, soldOut: dish.soldOut })} onCategory={() => setModal('category')} />}
        {tab === 'tables' && staff.role === 'admin' && <TablesView tables={tables} onAdd={() => setModal('table')} />}
      </div>
    </main>
    {modal === 'dish' && <DishModal dish={editingDish} categories={overview?.categories || []} onClose={() => setModal(null)} onSave={async (dish) => { await action('dish.save', dish); setModal(null) }} />}
    {modal === 'category' && <CategoryModal onClose={() => setModal(null)} onSave={async (name) => { await action('category.save', { name, sort: (overview?.categories.length || 0) + 1 }); setModal(null) }} />}
    {modal === 'table' && <TableModal onClose={() => setModal(null)} onSave={createTable} />}
    {modal === 'password' && <PasswordModal onClose={() => setModal(null)} onSaved={async () => { const result = await call<{ staff: Staff }>('auth.me'); const updated = result.staff; saveSession(sessionStorage.getItem('restaurant.session') || '', updated); setStaff(updated) }} />}
  </div>
}

// ===== 修改：登录页添加下拉框（保持原输入框尺寸和外观） =====
function Login({ onLogin, error }: { onLogin: (username: string, password: string) => void; error: string }) {
  const [username, setUsername] = useState(staffAccounts[0].username)
  const [password, setPassword] = useState(mockMode ? staffAccounts[0].password : '')
  const [bootstrap, setBootstrap] = useState(false); const [message, setMessage] = useState('')

  function selectAccount(next: string) {
    setUsername(next)
    const account = staffAccounts.find(item => item.username === next)
    if (mockMode && account) setPassword(account.password)
    else setPassword('')
  }

  async function initialize() { setMessage(''); try { const result: any = await call('admin.bootstrap', { password }); setMessage(result.message || '管理员已初始化，请使用该口令登录') } catch (e) { setMessage((e as Error).message) } }
  
  return <div className="login-page"><div className="login-card"><div className="login-brand"><div className="brand-mark"><Utensils size={22} /></div><div><strong>小满餐厅</strong><span>餐厅运营工作台</span></div></div><div className="login-intro"><p className="eyebrow">GOOD FOOD, GOOD MOMENTS</p><h1>欢迎回来</h1><p>登录以管理菜单、订单和每日运营。</p></div>{!bootstrap ? <form onSubmit={event => { event.preventDefault(); onLogin(username, password) }}>
    <label>
      员工账号
      <select 
        value={username} 
        onChange={event => selectAccount(event.target.value)}
        style={{
          display: 'block',
          width: '100%',
          boxSizing: 'border-box',
          padding: '12px 14px',
          paddingRight: '36px', // 给右侧箭头留出空间
          marginTop: '8px',
          border: '1px solid #dcdcdc',
          borderRadius: '6px',
          backgroundColor: '#fff',
          fontSize: '16px',
          color: '#333',
          outline: 'none',
          appearance: 'none', // 去掉系统默认下拉框样式
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 12px center',
          backgroundSize: '16px'
        }}
      >
        {staffAccounts.map(item => (
          <option key={item.username} value={item.username}>
            {roleLabels[item.role]}（{item.username}）
          </option>
        ))}
      </select>
    </label>
    <label>登录密码<input autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} /></label>{error && <div className="login-error">{error}</div>}<button className="button primary full" type="submit">登录工作台 <ArrowRight size={17} /></button></form> : <div><label>管理员初始口令<input autoComplete="new-password" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="输入 CloudBase ADMIN_BOOTSTRAP_PASSWORD" /></label>{message && <div className="login-error">{message}</div>}<button className="button primary full" onClick={() => void initialize()}>初始化管理员</button></div>}<div className="login-foot">{mockMode ? <>演示账号：{staffAccounts.map(item => item.username).join(' / ')}　·　密码：ChangeMe123!</> : <>CloudBase 环境：{import.meta.env.VITE_CLOUDBASE_ENV_ID}<br/><button className="text-button" onClick={() => setBootstrap(!bootstrap)}>{bootstrap ? '返回登录' : '首次部署？初始化管理员'}</button></>}</div></div><div className="login-art"><div className="art-orb"/><div className="art-copy"><span>FRESH FROM OUR KITCHEN</span><h2>每一桌，<br/>都值得用心。</h2><p>把点餐、出品与服务，连接得更简单。</p></div><div className="art-stamp">小满<br/>餐厅</div></div></div>
}
// ======================================

function OverviewView({ data, onNavigate }: { data: Overview | null; onNavigate: (tab: Tab) => void }) {
  if (!data) return <Loading />
  const todayOrders = data.orders.length
  return <><div className="welcome-row"><div><p className="eyebrow">TODAY AT A GLANCE</p><h2>今天也辛苦了</h2><p>订单正在实时更新，祝你有个好生意。</p></div><div className="date-chip">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</div></div><div className="stat-grid"><Stat label="进行中桌次" value={data.openSessions} note="正在用餐" icon={<Store />} tone="green"/><Stat label="待处理订单" value={data.openOrders} note="需要关注" icon={<ClipboardList />} tone="orange"/><Stat label="本桌次订单" value={todayOrders} note="当前开放桌次" icon={<Activity />} tone="blue"/><Stat label="今日营业额" value={`¥${Number(data.todayRevenue || 0).toFixed(2)}`} note="本地日期 · 模拟已付款" icon={<CircleDollarSign />} tone="purple"/></div><div className="section-heading"><div><h3>快捷入口</h3><p>常用管理功能</p></div></div><div className="quick-grid"><button className="quick-card" onClick={() => onNavigate('orders')}><div className="quick-icon terracotta"><ClipboardList/></div><strong>处理订单</strong><span>确认新订单与完成结账</span><ArrowRight/></button><button className="quick-card" onClick={() => onNavigate('menu')}><div className="quick-icon sage"><Utensils/></div><strong>管理菜单</strong><span>编辑菜品、规格和售罄状态</span><ArrowRight/></button><button className="quick-card" onClick={() => onNavigate('tables')}><div className="quick-icon sand"><Store/></div><strong>桌台管理</strong><span>查看桌台状态并添加餐桌</span><ArrowRight/></button></div><div className="section-heading"><div><h3>当前桌次</h3><p>正在营业的餐桌</p></div><button className="text-button" onClick={() => onNavigate('orders')}>查看订单 <ArrowRight size={15}/></button></div><ActiveTables data={data}/></>
}
function Stat({ label, value, note, icon, tone }: { label: string; value: any; note: string; icon: React.ReactNode; tone: string }) { return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{note}</small></div> }
function ActiveTables({ data }: { data: Overview }) { if (!data.sessions.length) return <div className="empty-panel">目前没有进行中的桌次</div>; return <div className="table-overview">{data.sessions.slice(0, 6).map(session => { const orders = data.orders.filter(order => order.sessionId === (session.id || session._id)); return <div className="table-overview-card" key={session.id || session._id}><div><span className="live-dot"/> 进行中</div><strong>{session.tableId.slice(-5)}</strong><small>{orders.length} 批订单</small></div> })}</div> }

function OrdersView({ overview, onAction, canServe }: { overview: Overview | null; onAction: (action: string, payload?: any) => Promise<void>; canServe: boolean }) {
  const [selected, setSelected] = useState<string>('all'); const [refund, setRefund] = useState<OrderItemModal | null>(null)
  if (!overview) return <Loading />
  const sessions = overview.sessions
  const orders = overview.orders.filter(order => selected === 'all' || order.sessionId === selected)
  return <><div className="page-intro"><div><p className="eyebrow">FRONT OF HOUSE</p><h2>订单与上桌</h2><p>确认已付款订单，并逐道确认菜品已经送到顾客桌上。</p></div><div className="live-pill"><span className="live-dot"/> 每 8 秒刷新</div></div><div className="filter-row"><label className="select-wrap"><Store size={17}/><select value={selected} onChange={event => setSelected(event.target.value)}><option value="all">所有进行中桌次</option>{sessions.map(session => <option key={session.id || session._id} value={session.id || session._id}>{session.tableId.slice(-5)} · {new Date(session.openedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 开桌</option>)}</select></label><span className="result-count">{orders.length} 批订单</span></div>{!orders.length ? <div className="empty-panel">当前没有需要处理的订单</div> : <div className="order-list">{orders.map(order => <OrderCard key={order.id} order={order} session={sessions.find(s => (s.id || s._id) === order.sessionId)} onAction={onAction} canServe={canServe} onRefund={(itemIndex, item) => setRefund({ order, itemIndex, item })} />)}</div>}{sessions.length > 0 && <div className="checkout-strip"><div><strong>桌次状态</strong><span>顾客在小程序中结束本桌；所有订单须先付款且所有菜品已上桌。</span></div></div>}{refund && <RefundModal value={refund} onClose={() => setRefund(null)} onSave={async quantity => { await onAction('item.refund', { orderId: refund.order.id, itemIndex: refund.itemIndex, quantity, reason: (document.getElementById('refund-reason') as HTMLInputElement)?.value }); setRefund(null) }} />}</>
}
type OrderItemModal = { order: Order; itemIndex: number; item: Order['items'][number] }
function OrderCard({ order, session, onAction, canServe, onRefund }: { order: Order; session?: any; onAction: (action: string, payload?: any) => Promise<void>; canServe: boolean; onRefund: (index: number, item: Order['items'][number]) => void }) {
  const paid = order.paymentStatus === 'paid' || order.status === 'paid'
  const next = order.status === 'pending' && paid ? <button className="button primary" onClick={() => void onAction('order.confirm', { orderId: order.id })}>确认并交后厨</button> : order.status === 'pending' ? <span className="served-help">等待顾客完成模拟支付</span> : null
  const activeItems = order.items.reduce((sum, item) => sum + item.quantity - (item.refunds || []).reduce((n, refund) => n + refund.quantity, 0), 0)
  return <article className="order-card"><div className="order-card-head"><div><span className="table-kicker">桌台 {session?.tableId?.slice(-5) || order.tableId.slice(-5)}</span><h3>第 {order.batchNo} 批点餐 <span className={`order-status ${order.status}`}>{order.status === 'pending' && paid ? '已付款 · 待前台确认' : statusLabels[order.status] || order.status}</span></h3><small>{new Date(order.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 提交 · {activeItems} 份 · {paid ? `模拟已付款（${({ wechat: '微信', alipay: '支付宝', card: '银行卡' } as Record<string, string>)[order.paymentMethod || ''] || '旧订单'}）` : '待付款'}</small></div><div className="order-price">¥{(order.subtotal - (order.refundedTotal || 0)).toFixed(2)}</div></div><div className="order-lines">{order.items.map((item, index) => <div className="order-line" key={`${item.dishId}-${index}`}><div className="order-dish"><strong>{item.name} <span>× {item.quantity}</span></strong><small>{item.optionNames.join(' · ')}{item.note ? ` · 备注：${item.note}` : ''}</small><small>制作：{({ pending: '待制作', preparing: '制作中', ready: '已备好' } as Record<string, string>)[item.productionStatus || 'pending']} · 上桌：{item.serviceStatus === 'served' || item.status === 'served' ? '已上桌' : '未上桌'}</small>{item.refunds?.map((entry, idx) => <small className="refund-note" key={idx}>已退 {entry.quantity} 份 · {entry.reason}</small>)}</div><span className="line-price">¥{(item.unitPrice * item.quantity).toFixed(2)}</span>{canServe && item.productionStatus === 'ready' && item.serviceStatus !== 'served' && <button className="text-button" onClick={() => void onAction('item.serve', { orderId: order.id, itemIndex: index })}>确认已上桌</button>}<button className="text-button danger" onClick={() => onRefund(index, item)}>退菜</button></div>)}</div><div className="order-actions">{next}{order.status === 'served' && paid && <span className="served-help">本批已付款、菜品已上齐</span>}</div></article>
}
function RefundModal({ value, onClose, onSave }: { value: OrderItemModal; onClose: () => void; onSave: (quantity: number) => void }) { const [quantity, setQuantity] = useState(1); const [reason, setReason] = useState(''); return <Modal title="登记单品退菜" onClose={onClose}><div className="modal-copy">{value.item.name} · 原点 {value.item.quantity} 份</div><label>退菜数量<input type="number" min="1" max={value.item.quantity} value={quantity} onChange={e => setQuantity(Number(e.target.value))}/></label><label>退菜原因<input id="refund-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：顾客临时更改"/></label><div className="modal-actions"><button className="button quiet" onClick={onClose}>取消</button><button disabled={!reason.trim()} className="button primary" onClick={() => onSave(quantity)}>确认退菜</button></div></Modal> }

function KitchenView({ orders, onAction }: { orders: Order[]; onAction: (action: string, payload?: any) => Promise<void> }) { return <><div className="page-intro"><div><p className="eyebrow">KITCHEN DISPLAY</p><h2>后厨制作看板</h2><p>前台确认已付款订单后，逐道更新制作状态；服务员负责确认上桌。</p></div><div className="live-pill"><span className="live-dot"/> 自动刷新</div></div>{!orders.length ? <div className="kitchen-empty"><ChefHat size={34}/><strong>暂时没有待制作订单</strong><span>新订单经付款和前台确认后会显示在这里</span></div> : <div className="kitchen-grid">{orders.map(order => <article className={`kitchen-card ${order.status}`} key={order.id}><header><div><span className="kitchen-table">桌台 {order.tableId.slice(-5)}</span><span className="kitchen-batch">第 {order.batchNo} 批</span></div><span className="kitchen-time">{new Date(order.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></header><div className="kitchen-items">{order.items.map((item, idx) => <div className="kitchen-item" key={idx}><div><strong>{item.name}</strong><small>{item.optionNames.join(' · ')}{item.note ? ` · ${item.note}` : ''}</small></div><div>{item.productionStatus === 'pending' && <button className="button primary" onClick={() => void onAction('item.start', { orderId: order.id, itemIndex: idx })}>开始制作</button>}{item.productionStatus === 'preparing' && <button className="button kitchen-done" onClick={() => void onAction('item.ready', { orderId: order.id, itemIndex: idx })}>标记备好</button>}{item.productionStatus === 'ready' && <b>已备好</b>}</div></div>)}</div></article>)}</div>}</> }

function MenuView({ overview, filter, setFilter, onAdd, onEdit, onAvailability, onPublish, onCategory }: { overview: Overview | null; filter: string; setFilter: (value: string) => void; onAdd: () => void; onEdit: (dish: Dish) => void; onAvailability: (dish: Dish) => void; onPublish: (dish: Dish) => void; onCategory: () => void }) {
  const [categoryId, setCategoryId] = useState('')
  if (!overview) return <Loading />
  const selectedCategory = overview.categories.some(category => category.id === categoryId) ? categoryId : ''
  const dishes = overview.dishes.filter(dish => (!selectedCategory || dish.categoryId === selectedCategory) && `${dish.name} ${dish.description}`.toLowerCase().includes(filter.toLowerCase()))
  return <><div className="page-intro"><div><p className="eyebrow">MENU & AVAILABILITY</p><h2>菜单管理</h2><p>菜品变更会应用于新订单，历史订单保留提交时的价格快照。</p></div><button className="button primary" onClick={onAdd}><Plus size={17}/> 新增菜品</button></div><div className="menu-toolbar"><div className="search-box"><Search size={17}/><input placeholder="搜索菜品" value={filter} onChange={e => setFilter(e.target.value)}/></div><button className="button outline" onClick={onCategory}><Plus size={16}/> 新建分类</button></div><div className="category-chips" role="group" aria-label="category filter"><button type="button" className={!selectedCategory ? 'active' : ''} aria-pressed={!selectedCategory} onClick={() => setCategoryId('')}>{'全部'}</button>{overview.categories.map(category => <button type="button" key={category.id} className={selectedCategory === category.id ? 'active' : ''} aria-pressed={selectedCategory === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div>{!dishes.length ? <div className="empty-panel">没有匹配的菜品</div> : <div className="menu-grid">{dishes.map(dish => <article className={`menu-card ${!dish.active || dish.soldOut ? 'unavailable' : ''}`} key={dish.id}><div className="dish-thumb">{dish.imageUrl ? <img src={dish.imageUrl} alt=""/> : <span>🍽️</span>}<span className={`availability ${dish.soldOut ? 'sold' : dish.active ? '' : 'off'}`}>{dish.soldOut ? '售罄' : dish.active ? '在售' : '已下架'}</span></div><div className="menu-card-body"><span className="menu-category">{overview.categories.find(item => item.id === dish.categoryId)?.name || '未分类'}</span><h3>{dish.name}</h3><p>{dish.description || '暂无描述'}</p><div className="menu-card-foot"><strong>¥{dish.basePrice.toFixed(2)}</strong><div><button className="text-button" onClick={() => onEdit(dish)}>编辑</button><button className="text-button" onClick={() => onAvailability(dish)}>{dish.soldOut ? '恢复售卖' : '设为售罄'}</button><button className="text-button" onClick={() => onPublish(dish)}>{dish.active ? '下架' : '上架'}</button></div></div>{dish.options.length > 0 && <small className="options-hint">{dish.options.map(group => group.group).join(' / ')}</small>}</div></article>)}</div>}</> 
}

function TablesView({ tables, onAdd }: { tables: Table[]; onAdd: () => void }) {
  return <><div className="page-intro"><div><p className="eyebrow">DINING TABLES</p><h2>桌台管理</h2><p>顾客进入小程序后选择桌号，再开始点餐。</p></div><button className="button primary" onClick={onAdd}><Plus size={17}/> 添加桌台</button></div><div className="table-grid">{tables.map(table => <article className="table-card" key={table.id}><div className="table-card-top"><div className="table-icon"><Store size={20}/></div><span className={table.currentSession ? 'pill-live' : 'pill-idle'}>{table.currentSession ? '用餐中' : '空闲'}</span></div><h3>{table.name}</h3><p>{table.currentSession ? `开桌于 ${new Date(table.currentSession.openedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '等待顾客选择桌号'}</p></article>)}{!tables.length && <div className="empty-panel">尚未添加桌台</div>}</div></>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={event => event.stopPropagation()}><header><h3>{title}</h3><button className="icon-button" onClick={onClose}><X size={18}/></button></header>{children}</section></div> }
function DishModal({ dish, categories, onClose, onSave }: { dish: Dish | null; categories: Category[]; onClose: () => void; onSave: (dish: any) => Promise<void> }) {
  const [name, setName] = useState(dish?.name || ''); const [description, setDescription] = useState(dish?.description || ''); const [categoryId, setCategoryId] = useState(dish?.categoryId || categories[0]?.id || ''); const [basePrice, setBasePrice] = useState(dish?.basePrice ?? 0); const [options, setOptions] = useState(JSON.stringify(dish?.options || [], null, 2)); const [imageFileId, setImageFileId] = useState(dish?.imageFileId || ''); const [imageUrl, setImageUrl] = useState(dish?.imageUrl || ''); const [saving, setSaving] = useState(false); const [localError, setLocalError] = useState('')
  async function submit(event: React.FormEvent) { event.preventDefault(); setLocalError(''); let parsed; try { parsed = JSON.parse(options || '[]'); if (!Array.isArray(parsed)) throw new Error() } catch { setLocalError('规格配置需要是有效的 JSON 数组'); return }; setSaving(true); try { await onSave({ id: dish?.id, name, description, categoryId, basePrice: Number(basePrice), options: parsed, imageFileId, imageUrl, active: dish?.active ?? true, soldOut: dish?.soldOut ?? false, sort: dish?.sort ?? 0 }) } catch (e) { setLocalError((e as Error).message) } finally { setSaving(false) } }
  return <Modal title={dish ? '编辑菜品' : '新增菜品'} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-grid"><label>菜品名称<input required value={name} onChange={e => setName(e.target.value)} placeholder="例如：招牌红烧肉"/></label><label>所属分类<select required value={categoryId} onChange={e => setCategoryId(e.target.value)}>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label></div><label>菜品描述<input value={description} onChange={e => setDescription(e.target.value)} placeholder="简单介绍口味与做法"/></label><label>基础价格（元）<input required type="number" min="0" step="0.01" value={basePrice} onChange={e => setBasePrice(Number(e.target.value))}/></label><label>规格选项（JSON）<textarea rows={5} value={options} onChange={e => setOptions(e.target.value)}/><small>示例：[{`{"group":"份量","required":true,"choices":[{"name":"标准份","priceDelta":0}]}`} ]</small></label><label>菜品图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { setLocalError('图片不能超过 2MB'); return }; try { const result = await uploadImage(file); setImageFileId(result.fileID); setImageUrl(result.url) } catch (error) { setLocalError((error as Error).message) } }}/>{imageUrl && <img className="preview-image" src={imageUrl} alt="菜品预览"/>}</label>{localError && <div className="login-error">{localError}</div>}<div className="modal-actions"><button type="button" className="button quiet" onClick={onClose}>取消</button><button disabled={saving} className="button primary">{saving ? '保存中…' : '保存菜品'}</button></div></form></Modal>
}
function CategoryModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) { const [name, setName] = useState(''); return <Modal title="新建菜品分类" onClose={onClose}><label>分类名称<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="例如：主食"/></label><div className="modal-actions"><button className="button quiet" onClick={onClose}>取消</button><button disabled={!name.trim()} className="button primary" onClick={() => onSave(name)}>创建分类</button></div></Modal> }
function TableModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) { const [name, setName] = useState(''); return <Modal title="添加餐桌" onClose={onClose}><label>桌台名称<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="例如：1号桌"/></label><p className="modal-copy">添加后，顾客可以在小程序的桌号列表中选择这张桌台。</p><div className="modal-actions"><button className="button quiet" onClick={onClose}>取消</button><button disabled={!name.trim()} className="button primary" onClick={() => onSave(name)}>创建桌台</button></div></Modal> }
function PasswordModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) { const [currentPassword, setCurrent] = useState(''); const [newPassword, setNext] = useState(''); const [message, setMessage] = useState(''); async function save() { try { await call('auth.changePassword', { currentPassword, newPassword }); await onSaved(); setMessage('密码已更新'); window.setTimeout(onClose, 900) } catch (e) { setMessage((e as Error).message) } }; return <Modal title="修改登录密码" onClose={onClose}><label>当前密码<input type="password" value={currentPassword} onChange={e => setCurrent(e.target.value)}/></label><label>新密码<input type="password" value={newPassword} onChange={e => setNext(e.target.value)} placeholder="至少 12 位，包含大小写字母和数字"/></label>{message && <div className="modal-copy">{message}</div>}<div className="modal-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" onClick={() => void save()}>保存新密码</button></div></Modal> }
function Loading() { return <div className="loading"><span className="spinner"/> 正在读取工作台数据…</div> }
