import { Link, useNavigate } from 'react-router-dom';
import { HiPlus } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

function Navbar() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out');
    navigate('/');
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo">
          <span>🛡️</span> PostureSec
        </Link>
        <div className="navbar-actions">
          {/* Writing requires a session, so only offer it to someone who has one. */}
          {user && (
            <Link to="/create" className="btn btn-primary">
              <HiPlus size={18} />
              <span>New Post</span>
            </Link>
          )}
          {/* Render nothing until the first /auth/me settles, so the navbar does
              not flash "Sign in" at an already-signed-in visitor. */}
          {!loading &&
            (user ? (
              <button type="button" className="btn btn-secondary" onClick={handleSignOut}>
                Sign out ({user.email})
              </button>
            ) : (
              <Link to="/login" className="btn btn-secondary">
                Sign in
              </Link>
            ))}
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
