import React from 'react';
import { LayoutDashboard, BookOpen, Users, ShieldCheck, Zap, X, Settings2, LogOut, ArrowUpRight } from 'lucide-react';

export default function Sidebar({
  mobileNavOpen, setMobileNavOpen, view, setView, canManageContent,
  signedIn, session, handleSignOut, navigate, scrollTo, setAuthOpen
}) {
  const items = [
    ['home', 'Home', LayoutDashboard],
    ['notes', 'Library', BookOpen],
    ['students', 'Community', Users],
    ...(canManageContent ? [['admin', 'Admin Panel', ShieldCheck]] : []),
  ];

  return (
    <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-top">
        <button className="brand" onClick={() => setView('home')} aria-label="Go to home">
          <span className="brand-mark"><Zap size={20} fill="currentColor" /></span>
          <span>Tech <i>Titan</i></span>
        </button>
        {mobileNavOpen && (
          <button onClick={() => setMobileNavOpen(false)} aria-label="Close menu"><X size={24} /></button>
        )}
      </div>

      <nav className="sidebar-nav" aria-label="Primary navigation">
        <span className="nav-label">Your desk</span>
        {items.map(([key, label, Icon]) => (
          <button
            key={key}
            className={`nav-item ${view === key ? 'active' : ''}`}
            onClick={() => {
              setView(key);
              setTimeout(() => {
                if (key === 'home') window.scrollTo(0,0);
                else scrollTo(key);
              }, 100);
              setMobileNavOpen(false);
            }}
          >
            <Icon size={20} /> {label}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        {signedIn ? (
          <div className="user-chip">
            <div className="avatar-circle">{session?.user?.name?.slice(0, 2).toUpperCase() || 'TT'}</div>
            <div className="who">
              <strong>{session?.user?.name || 'Student'}</strong>
              <small>{session?.user?.year || 'Member'}</small>
            </div>
            <div className="actions">
              <button onClick={() => navigate('profile')} title="Profile settings" aria-label="Profile settings"><Settings2 size={16} /></button>
              <button onClick={handleSignOut} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button>
            </div>
          </div>
        ) : (
          <button className="button button-block" onClick={() => setAuthOpen(true)}>
            Sign in <ArrowUpRight size={18} />
          </button>
        )}
      </div>
    </aside>
  );
}
