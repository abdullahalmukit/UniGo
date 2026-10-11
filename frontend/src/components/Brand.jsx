export default function Brand({ dark }) {
  return (
    <div className={`brand ${dark ? 'brand-dark' : ''}`}>
      <span className="brand-logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M5 20 L12 3 L19 20 L12 15.5 Z" fill="#0B1F3A" />
        </svg>
      </span>
      <span className="brand-name">UniGo</span>
    </div>
  );
}
