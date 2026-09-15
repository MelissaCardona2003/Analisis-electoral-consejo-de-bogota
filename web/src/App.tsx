import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { ThemeToggle } from './components/ThemeToggle'

const Resumen = lazy(() => import('./pages/Resumen'))
const Resultados = lazy(() => import('./pages/Resultados'))
const Mapa = lazy(() => import('./pages/Mapa'))
const Territorio = lazy(() => import('./pages/Territorio'))
const Candidatos = lazy(() => import('./pages/Candidatos'))
const Pronostico = lazy(() => import('./pages/Pronostico'))
const Simulador = lazy(() => import('./pages/Simulador'))
const Metodologia = lazy(() => import('./pages/Metodologia'))

const NAV = [
  { to: '/', label: 'Resumen' },
  { to: '/resultados', label: 'Resultados' },
  { to: '/mapa', label: 'Mapa' },
  { to: '/territorio', label: 'Territorio' },
  { to: '/candidatos', label: 'Candidatos' },
  { to: '/pronostico', label: 'Pronóstico 2027' },
  { to: '/simulador', label: 'Simulador' },
  { to: '/metodologia', label: 'Metodología' },
]

function LogoMark() {
  const puntos = []
  for (let fila = 0; fila < 3; fila++) {
    const r = 5 + fila * 3.2
    const n = 4 + fila * 2
    for (let k = 0; k < n; k++) {
      const a = Math.PI * (1 - k / (n - 1))
      puntos.push(<circle key={`${fila}-${k}`} cx={12 + r * Math.cos(a)} cy={17 - r * Math.sin(a)} r={1.15} />)
    }
  }
  return (
    <svg viewBox="0 0 24 20" className="h-6 w-7 fill-ink" aria-hidden="true">
      {puntos}
    </svg>
  )
}

function Cargando() {
  return (
    <div className="grid min-h-[50vh] place-items-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="size-2 animate-pulse rounded-full bg-ink" />
        Cargando datos…
      </div>
    </div>
  )
}

class LimiteDeError extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card mx-auto mt-16 max-w-lg p-8 text-center">
        <p className="eyebrow">Algo falló</p>
        <p className="mt-2 text-ink-2">{this.state.error.message}</p>
        <button className="mt-6 rounded-full bg-ink px-4 py-2 text-sm text-plane" onClick={() => location.reload()}>
          Reintentar
        </button>
      </div>
    )
  }
}

export default function App() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-50 border-b border-hairline bg-plane/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 md:px-8 lg:flex-nowrap">
          <NavLink to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Inicio">
            <LogoMark />
            <span className="leading-tight">
              <span className="block text-[13px] font-semibold tracking-tight">Concejo de Bogotá</span>
              <span className="block text-[11px] text-muted">Observatorio electoral · 2019–2027</span>
            </span>
          </NavLink>
          <div className="ml-auto lg:order-last">
            <ThemeToggle />
          </div>
          <nav
            aria-label="Secciones"
            className="order-last -mx-1 flex w-full items-center gap-0.5 overflow-x-auto pb-1 [scrollbar-width:none] lg:order-none lg:w-auto lg:flex-1 lg:justify-center lg:pb-0 [&::-webkit-scrollbar]:hidden"
          >
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  `shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    isActive ? 'bg-ink text-plane' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-24 pt-8 md:px-8 md:pt-14">
        <LimiteDeError>
          <Suspense fallback={<Cargando />}>
            <Routes>
              <Route path="/" element={<Resumen />} />
              <Route path="/resultados" element={<Resultados />} />
              <Route path="/mapa" element={<Mapa />} />
              <Route path="/territorio" element={<Territorio />} />
              <Route path="/candidatos" element={<Candidatos />} />
              <Route path="/pronostico" element={<Pronostico />} />
              <Route path="/simulador" element={<Simulador />} />
              <Route path="/metodologia" element={<Metodologia />} />
              <Route path="*" element={<Resumen />} />
            </Routes>
          </Suspense>
        </LimiteDeError>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-2 px-4 py-8 text-xs text-muted md:flex-row md:items-center md:justify-between md:px-8">
          <p>
            Fuente: Registraduría Nacional del Estado Civil — resultados mesa a mesa (escrutinio) y censo electoral.
            Procesamiento y modelo propios.
          </p>
          <p>Corte de datos: septiembre de 2026 · Próxima elección: 31 de octubre de 2027</p>
        </div>
      </footer>
    </div>
  )
}
