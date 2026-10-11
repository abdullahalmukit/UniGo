import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Brand from '../components/Brand.jsx';

const services = [
  { key: 'ride', title: 'Ride Sharing', text: 'Join a ride or ask for one', icon: '🚗' },
  { key: 'carpool', title: 'Carpool', text: 'Weekly seats on fixed routes', icon: '👥' },
  { key: 'food', title: 'Food Delivery', text: 'Get food brought to you', icon: '🍱' },
  { key: 'service', title: 'Uni Service', text: 'Pickups, printing, errands', icon: '🎒' },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomePage() {
  const { user, logout } = useAuth();
  const [notice, setNotice] = useState('');

  // First name without "Md." style prefixes
  const firstName = user.fullName.split(' ').filter((part) => !part.endsWith('.'))[0] || user.fullName;

  const comingSoon = (name) => {
    setNotice(`${name} is coming soon.`);
    setTimeout(() => setNotice(''), 2500);
  };

  return (
    <div className="home">
      <header className="top">
        <nav className="nav">
          <Brand dark />
          <div className="nav-right">
            <div className="nav-user">
              <span className="avatar">{firstName[0].toUpperCase()}</span>
              <span className="nav-name">{user.fullName}</span>
            </div>
            <button className="btn-ghost" onClick={logout}>Log out</button>
          </div>
        </nav>

        <div className="top-content">
          <p className="top-greeting">{greeting()}, {firstName}</p>
          <h1>Where are you headed?</h1>

          <div className="search">
            <button className="stop" onClick={() => comingSoon('Ride Sharing')}>
              <span className="route-dot" />
              <span>Pickup location</span>
            </button>
            <button className="stop" onClick={() => comingSoon('Ride Sharing')}>
              <span className="route-square" />
              <span>Destination</span>
            </button>
            <button className="btn btn-primary search-btn" onClick={() => comingSoon('Ride Sharing')}>Find a ride</button>
          </div>
        </div>
      </header>

      <main className="content">
        {!user.universityVerified && (
          <div className="banner">
            <div>
              <strong>Verify your university</strong>
              <p>
                {user.universityName
                  ? `Verification for ${user.universityName} opens soon.`
                  : 'Add your university to get verified. This opens soon.'}
              </p>
            </div>
          </div>
        )}

        <h2 className="section-title">What do you need?</h2>
        <div className="services">
          {services.map((service) => (
            <button key={service.key} className="service" onClick={() => comingSoon(service.title)}>
              <span className="service-icon">{service.icon}</span>
              <strong>{service.title}</strong>
              <span>{service.text}</span>
            </button>
          ))}
        </div>

        <h2 className="section-title">Your activity</h2>
        <div className="empty">
          <strong>No trips or requests yet</strong>
          <p>Rides you book or offer will show up here.</p>
        </div>
      </main>

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}
