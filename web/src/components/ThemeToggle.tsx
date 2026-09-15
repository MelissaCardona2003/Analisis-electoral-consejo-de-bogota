import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

type Tema = 'claro' | 'oscuro' | 'sistema'
const OPCIONES: { id: Tema; label: string; Icon: typeof Sun }[] = [
  { id: 'claro', label: 'Tema claro', Icon: Sun },
  { id: 'sistema', label: 'Tema del sistema', Icon: Monitor },
  { id: 'oscuro', label: 'Tema oscuro', Icon: Moon },
]

function leerTema(): Tema {
  try {
    return (localStorage.getItem('tema') as Tema) || 'sistema'
  } catch {
    return 'sistema'
  }
}

export function aplicarTema(t: Tema) {
  const oscuro = t === 'oscuro' || (t === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = oscuro ? 'dark' : 'light'
  window.dispatchEvent(new CustomEvent('tema', { detail: oscuro ? 'dark' : 'light' }))
}

export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>(leerTema)

  useEffect(() => {
    aplicarTema(tema)
    try {
      localStorage.setItem('tema', tema)
    } catch {
      /* almacenamiento no disponible */
    }
    if (tema !== 'sistema') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => aplicarTema('sistema')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [tema])

  return (
    <div role="radiogroup" aria-label="Tema" className="flex items-center rounded-full border border-hairline bg-surface p-0.5">
      {OPCIONES.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={tema === id}
          aria-label={label}
          title={label}
          onClick={() => setTema(id)}
          className={`grid size-7 place-items-center rounded-full transition-colors ${
            tema === id ? 'bg-ink text-plane' : 'text-muted hover:text-ink'
          }`}
        >
          <Icon size={14} strokeWidth={2} />
        </button>
      ))}
    </div>
  )
}

/** Tema efectivo (light/dark) para componentes que necesitan re-renderizar, p. ej. el mapa. */
export function useTemaEfectivo(): 'light' | 'dark' {
  const [t, setT] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent).detail)
    window.addEventListener('tema', on)
    return () => window.removeEventListener('tema', on)
  }, [])
  return t
}
