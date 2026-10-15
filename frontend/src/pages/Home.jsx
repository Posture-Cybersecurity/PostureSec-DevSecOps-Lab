import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getPosts } from '../api';
import PostCard from '../components/PostCard';
import { HiPlus } from 'react-icons/hi';

const POSTS_PAGE_SIZE = 20;

function Home() {
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: POSTS_PAGE_SIZE,
    totalCount: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');

    getPosts({ page, limit: POSTS_PAGE_SIZE })
      .then((res) => {
        if (!current) return;
        setPosts(res.data.data);
        setPagination(res.data);
      })
      .catch((err) => {
        if (!current) return;
        console.error('Failed to fetch posts:', err);
        setError('Posts could not be loaded. Please try again.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [page]);

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div>
      <div className="home-header">
        <h1>Welcome to PostureSec 🛡️</h1>
        <p>This is a local deployment of my Engineering project, I love what I'm seeing, this is done by Emmanuel of braco Sqaud</p>
        <div className="vibe-tags">
          <span className="vibe-tag">🔒 threat intel</span>
          <span className="vibe-tag">🛡️ zero trust</span>
          <span className="vibe-tag">🔍 security posture</span>
        </div>
      </div>

      {error && <p className="posts-error" role="alert">{error}</p>}

      {posts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-emoji">📝</div>
          <h3>No posts yet</h3>
          <p>Be the first to share security insights with the team</p>
          <Link to="/create" className="btn btn-primary">
            <HiPlus size={18} />
            Write something
          </Link>
        </div>
      ) : (
        <div className="posts-grid">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <nav className="posts-pagination" aria-label="Posts pagination">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((currentPage) => currentPage - 1)}
          >
            Previous
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
            {' '}({pagination.totalCount} posts)
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page >= pagination.totalPages || loading}
            onClick={() => setPage((currentPage) => currentPage + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

export default Home;
