/**
 * dsh-projection-guard — client half.
 *
 * Minimal observability card: shows guard status (wrapped put calls, dropped
 * rows, repaired titles) inside the settings page. Pure display — no controls.
 */
export const name = 'dsh-projection-guard'

export async function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  const fetchStatus = async () => {
    try {
      const res = await fetch('/projection-guard/status', { headers: { accept: 'application/json' } })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  slots.inject('settings.general', () => slots.register(
    { name: 'settings.general', id: 'dsh-projection-guard' },
    (props) => {
      const { React } = props
      const [status, setStatus] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          const value = await fetchStatus()
          if (alive) setStatus(value)
        }
        void load()
        const timer = setInterval(() => { void load() }, 5000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])
      return React.createElement('div', { style: { padding: '8px 0' } },
        React.createElement('h4', null, 'dsh-projection-guard'),
        status === null
          ? React.createElement('p', null, '状态不可用')
          : React.createElement('ul', { style: { margin: 0, paddingLeft: 20, lineHeight: 1.6 } },
            React.createElement('li', null, `put 调用: ${status.wrappedPutCalls ?? 0}`),
            React.createElement('li', null, `丢弃的非 JSON 行: ${status.droppedRows ?? 0}`),
            React.createElement('li', null, `自愈补全标题: ${status.repairedTitles ?? 0}`),
          ),
      )
    },
  ))
}

export default { name, apply }
