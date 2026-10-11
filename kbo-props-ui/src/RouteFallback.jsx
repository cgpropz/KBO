export default function RouteFallback({ inset = false }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: inset ? '40vh' : '100vh',
        minHeight: inset ? 240 : undefined,
        background: inset ? '#050506' : 'linear-gradient(135deg, #04140a, #22c55e)',
        color: 'white',
        fontSize: inset ? '18px' : '24px',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      Loading cgpropz…
    </div>
  )
}
