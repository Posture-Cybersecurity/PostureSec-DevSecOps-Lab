import axios from 'axios';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  // The session cookie is HttpOnly, so the browser must be told to send it.
  // Without this, every write is answered 401 no matter who is signed in.
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Posts
export const getPosts = () => api.get('/posts');
export const getPost = (id) => api.get(`/posts/${id}`);
export const createPost = (data) => api.post('/posts', data);
export const updatePost = (id, data) => api.put(`/posts/${id}`, data);
export const deletePost = (id) => api.delete(`/posts/${id}`);

// Comments
export const getComments = (postId) => api.get(`/comments/post/${postId}`);
export const createComment = (data) => api.post('/comments', data);
export const deleteComment = (id) => api.delete(`/comments/${id}`);

// Incident (War Room exercise). Absent in the plain lab — callers treat a
// failure as "no incident" and render nothing.
export const getIncidentStatus = () => api.get('/incident/status');
export const getIncident = () => api.get('/incident');
// INC-004 squad workspace (signed-in users only).
export const getIncidentWorkspace = () => api.get('/incident/workspace');
export const performIncidentAction = (action) => api.post('/incident/actions', { action });
export const submitIncidentReport = (data) => api.post('/incident/report', data);
// INC-004 LIVE: the squad's real EC2 lab.
export const liveStart = () => api.post('/incident/live/start');
export const liveEvidence = (id) => api.post('/incident/live/evidence', { id });
export const liveConfig = (cidrs) => api.post('/incident/live/config', { cidrs });
export const livePlan = () => api.post('/incident/live/plan');
export const liveReview = (plan) => api.post('/incident/live/review', { plan });
export const liveApply = (plan) => api.post('/incident/live/apply', { plan });
export const liveReport = (data) => api.post('/incident/live/report', data);
export const liveCleanup = () => api.post('/incident/live/cleanup');
// INC-005 (console hotfix drift): read the squad's saved plan before applying it.
export const liveInspect = (plan) => api.post('/incident/live/inspect', { plan });

// Auth
export const register = (data) => api.post('/auth/register', data);
export const login = (data) => api.post('/auth/login', data);
export const logout = () => api.post('/auth/logout');
export const me = () => api.get('/auth/me');

export default api;
