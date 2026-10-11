// Pickup -> destination graphic. This is the visual idea of UniGo.
export default function RouteLine({ from, fromNote, to, toNote }) {
  return (
    <div className="route">
      <div className="route-track">
        <span className="route-dot" />
        <span className="route-dashes" />
        <span className="route-square" />
      </div>
      <div className="route-labels">
        <div>
          <p className="route-place">{from}</p>
          {fromNote && <p className="route-note">{fromNote}</p>}
        </div>
        <div>
          <p className="route-place">{to}</p>
          {toNote && <p className="route-note">{toNote}</p>}
        </div>
      </div>
    </div>
  );
}
