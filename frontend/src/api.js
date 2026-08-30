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

// Auth
export const register = (data) => api.post('/auth/register', data);
export const login = (data) => api.post('/auth/login', data);
export const logout = () => api.post('/auth/logout');
export const me = () => api.get('/auth/me');

export default api;
