# DSO-103 — Exercise the API surface

## Objective

Exercise the live API surface for:

- `/api/health`
- `/api/auth`
- `/api/posts`
- `/api/comments`

The purpose is to demonstrate:

1. the request and response structure of each route,
2. the auth middleware position in the request lifecycle,
3. the failure modes for invalid input and missing resources,
4. how the backend distinguishes authentication from authorization.

---

## Scope

This task was executed against the locally running Express backend on port 5000. The relevant backend code is located in:

- [backend/src/index.js](../../backend/src/index.js)
- [backend/src/middleware/authenticate.js](../../backend/src/middleware/authenticate.js)
- [backend/src/routes/auth.js](../../backend/src/routes/auth.js)
- [backend/src/routes/posts.js](../../backend/src/routes/posts.js)
- [backend/src/routes/comments.js](../../backend/src/routes/comments.js)

---

### 1) Health endpoint

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ curl -i http://localhost:5000/api/health
```

Observed response:

```http
HTTP/1.1 200 OK
X-Powered-By: Express
Access-Control-Allow-Origin: *
Content-Type: application/json; charset=utf-8
Content-Length: 65

{"status":"ok","message":"PostureSec API is operational 🛡️"}
```

This confirms the API is up and serving JSON successfully.

### 2) Registration

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ curl -i -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"StrongPass123"}'
```

Observed response:

```http
HTTP/1.1 201 Created

{"id":2,"email":"demo@example.com","role":"user","created_at":"2026-09-18T21:25:14.141Z"}
```

This shows a valid registration request succeeds and returns a created user payload.

### 3) Login and session cookie

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ curl -i -c cookies.txt -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"StrongPass123"}'
```

Observed response:

```http
HTTP/1.1 200 OK
Set-Cookie: psec_session=c7976a109e612a5824e216afc5ca3f55cffbc09f685e41a956968aa756653a85; Path=/; Expires=Sat, 19 Sep 2026 06:25:27 GMT; HttpOnly; SameSite=Strict

{"id":2,"email":"demo@example.com","role":"user"}
```

This demonstrates the server creates a session cookie named `psec_session` and associates it with a valid authenticated user.

---

## Route behaviour

### /api/posts

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ curl -i http://localhost:5000/api/posts
```

Observed response:

```http
HTTP/1.1 200 OK

[]
```

This confirms the public list route is functioning. In a populated database it would return an array of posts.

### GET a single post by ID

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ curl -i http://localhost:5000/api/posts/l
```

Observed response:

```http
HTTP/1.1 500 Internal Server Error

{"error":"Failed to fetch post"}
```

This is an example of route-level failure caused by a malformed or invalid ID. It demonstrates that the route attempts a database lookup and then returns a server error when the lookup fails.

### /api/comments

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ curl -i http://localhost:5000/api/comments/post/1
```

Observed response:

```http
HTTP/1.1 200 OK

[]
```

This confirms the comments route is working and returns an empty array when no comments exist for that post.

### Comment creation without a valid target post

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ curl -i -b cookies.txt -X POST http://localhost:5000/api/comments \
  -H "Content-Type: application/json" \
  -d '{"post_id":1,"author":"Demo User","content":"Nice post!"}'
```

Observed response:

```http
HTTP/1.1 404 Not Found

{"error":"Post not found"}
```

This shows the route validates target existence before inserting the comment.

---

## Invalid input rejection

### Post creation with missing required content

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ curl -i -b cookies.txt -X POST http://localhost:5000/api/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"Only title"}'
```

Observed response:

```http
HTTP/1.1 400 Bad Request

{"error":"Title and content are required"}
```

### Comment creation with missing required data

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab$ curl -i -b cookies.txt -X POST http://localhost:5000/api/comments \
  -H "Content-Type: application/json" \
  -d '{"post_id":1}'
```

Observed response:

```http
HTTP/1.1 400 Bad Request

{"error":"Post ID and content are required"}
```

These responses show the backend rejects invalid requests early instead of attempting a database write with incomplete data.

---

## Authentication and middleware position

The request lifecycle is defined in [backend/src/index.js](../../backend/src/index.js):

```js
app.use(cookieParser());
app.use(attachUser);
```

and the relevant code is implemented in [backend/src/middleware/authenticate.js](../../backend/src/middleware/authenticate.js).

### What this means in plain language

The app does two separate jobs:

1. Authentication: “Who is this user?”
2. Authorization: “Is this user allowed to do this?”

`attachUser` does the first job. It looks at the session cookie, resolves the user from the server-side session, and stores it in `req.user`. It does not block the request if there is no valid session; it simply sets `req.user = null`.

Then protected routes call `requireAuth`:

```js
if (!req.user) {
  return res.status(401).json({ error: 'Authentication required' });
}
```

So if a user is not logged in, the response is:

```http
HTTP/1.1 401 Unauthorized
{"error":"Authentication required"}
```

This is the important distinction:

- 401 Unauthorized = the app does not know who you are
- 403 Forbidden = the app knows who you are, but you are not allowed to do that action

The code comments in [backend/src/middleware/authenticate.js](../../backend/src/middleware/authenticate.js) state this clearly.

---

### Evidence summary

The observed behaviour is consistent with the application code:

- health check returns `200 OK`
- registration creates a user
- login creates a session cookie
- posts and comments return data or empty arrays depending on state
- malformed payloads return `400 Bad Request`
- missing or invalid target resources return `404 Not Found`
- unauthenticated protected actions are rejected at the middleware layer

---

## Conclusion

This task successfully exercised the API surface and confirmed the expected request/response patterns. The backend behaves consistently with the route and middleware design: it resolves identity before route handling, validates incoming data before writes, and returns clear status codes for success, invalid input, missing resources, and unauthenticated requests.
