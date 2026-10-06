import React, { useEffect } from 'react';
import { 
  LayoutDashboard, BookOpen, Users, ShieldCheck, Zap, X, 
  Settings2, LogOut, ArrowUpRight, GraduationCap, Building2, Mail, ShieldAlert, Megaphone
} from 'lucide-react';

export default function Sidebar({
  mobileNavOpen, setMobileNavOpen, view, setView, canManageContent,
  signedIn, session, handleSignOut, navigate, scrollTo, setAuthOpen
}) {
  const items = [
    ['home', 'Home', LayoutDashboard],
    ['notices', 'Notice Board', Megaphone],
    ['notes', 'Library', BookOpen],
    ['students', 'Community', Users],
    ...(canManageContent ? [['admin', 'Admin Panel', ShieldCheck]] : []),
  ];

  // Auto-close on ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && mobileNavOpen) {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileNavOpen, setMobileNavOpen]);

  // Prevent background page from moving up and down when mobile sidebar is open
  useEffect(() => {
    if (mobileNavOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [mobileNavOpen]);

  const handleNavClick = (key) => {
    setView(key);
    setMobileNavOpen(false);
    setTimeout(() => {
      if (key === 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
      else scrollTo(key);
    }, 80);
  };

  const handleProfileClick = () => {
    navigate('profile');
    setMobileNavOpen(false);
  };

  const handleSignOutClick = () => {
    setMobileNavOpen(false);
    handleSignOut();
  };

  const handleSignInClick = () => {
    setMobileNavOpen(false);
    setAuthOpen(true);
  };

  const user = session?.user;
  const initials = user?.name ? user.name.slice(0, 2).toUpperCase() : 'TT';
  const roleName = user?.role === 'admin' ? 'Administrator' : user?.role === 'content_admin' ? 'Content Admin' : 'Verified Student';

  return (
    <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-top">
        <button 
          className="brand" 
          onClick={() => {
            setView('home');
            setMobileNavOpen(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }} 
          aria-label="Go to home"
        >
          <span className="brand-mark"><Zap size={20} fill="currentColor" /></span>
          <span>Tech <i>Titan</i></span>
        </button>
        {mobileNavOpen && (
          <button 
            className="mobile-close-btn"
            onClick={() => setMobileNavOpen(false)} 
            aria-label="Close menu"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#f8fafc'
            }}
          >
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="sidebar-nav" aria-label="Primary navigation">
        <span className="nav-label">Command Center</span>
        {items.map(([key, label, Icon]) => (
          <button
            key={key}
            className={`nav-item ${view === key ? 'active' : ''}`}
            onClick={() => handleNavClick(key)}
          >
            <Icon size={19} /> {label}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot" style={{ marginTop: 'auto', paddingTop: '16px' }}>
        {signedIn ? (
          <div 
            className="user-profile-card"
            style={{
              background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.95) 0%, rgba(9, 15, 31, 0.98) 100%)',
              border: '1.5px solid rgba(0, 242, 254, 0.35)',
              borderRadius: '18px',
              padding: '16px 14px',
              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 242, 254, 0.12)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            {/* User Profile Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div 
                className="avatar-circle"
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #00f2fe 0%, #38bdf8 100%)',
                  color: '#040d1a',
                  fontWeight: '900',
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 15px rgba(0, 242, 254, 0.4)',
                  flexShrink: 0
                }}
              >
                {initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  marginBottom: '2px' 
                }}>
                  <strong style={{ 
                    fontSize: '0.95rem', 
                    color: '#f8fafc',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block'
                  }}>
                    {user?.name || 'Student'}
                  </strong>
                </div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.72rem',
                  fontWeight: '800',
                  color: user?.role === 'admin' ? '#f59e0b' : '#38bdf8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px'
                }}>
                  {user?.role === 'admin' && <ShieldAlert size={11} />}
                  {roleName}
                </div>
              </div>
            </div>

            {/* Quick Metadata Pill */}
            {(user?.college || user?.year) && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '10px',
                padding: '6px 10px',
                fontSize: '0.75rem',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px'
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Building2 size={12} style={{ color: '#00f2fe', flexShrink: 0 }} />
                  {user?.college || 'Member'}
                </span>
                <span style={{ color: '#38bdf8', fontWeight: '800', flexShrink: 0 }}>
                  {user?.year || ''}
                </span>
              </div>
            )}

            {/* Creative Two-Action Suite */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '2px' }}>
              <button
                onClick={handleProfileClick}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '9px 10px',
                  borderRadius: '10px',
                  background: 'rgba(0, 242, 254, 0.12)',
                  border: '1px solid rgba(0, 242, 254, 0.4)',
                  color: '#00f2fe',
                  fontSize: '0.8rem',
                  fontWeight: '800',
                  transition: 'all 0.18s ease'
                }}
                title="Edit student profile details"
              >
                <Settings2 size={14} /> Edit Info
              </button>

              <button
                onClick={handleSignOutClick}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '9px 10px',
                  borderRadius: '10px',
                  background: 'rgba(244, 63, 94, 0.12)',
                  border: '1px solid rgba(244, 63, 94, 0.4)',
                  color: '#fb7185',
                  fontSize: '0.8rem',
                  fontWeight: '800',
                  transition: 'all 0.18s ease'
                }}
                title="Sign out of student account"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          </div>
        ) : (
          <button 
            className="button button-block" 
            onClick={handleSignInClick}
            style={{
              background: 'linear-gradient(135deg, #00f2fe 0%, #38bdf8 100%)',
              color: '#040d1a',
              fontWeight: '900',
              boxShadow: '0 0 20px rgba(0, 242, 254, 0.3)'
            }}
          >
            Sign In <ArrowUpRight size={18} />
          </button>
        )}
      </div>
    </aside>
  );
}
