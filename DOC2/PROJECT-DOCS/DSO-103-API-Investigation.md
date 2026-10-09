# DSO-103: PostureSec API Surface Investigation Worksheet

## Overview
This document logs the hands-on exploration of PostureSec's core API endpoints (`/api/health`, `/api/posts`, `/api/comments`), detailing observed request/response behavior, failure modes, and authentication architecture.

---

## Investigation Worksheet Findings

### 01. What happens without authentication?
* **Observed Behavior:** Sending a request to a protected route (e.g., `POST /api/comments`) without an `Authorization` header fails authentication.
* **HTTP Status Code:** `401 Unauthorized`
* **Response Body:**
```json
{
  "error": "Unauthorized Access",
  "message": "Missing or invalid authorization token."
}


What does a valid request look like?
Observed Request: A POST request sent to /api/comments including a valid Bearer token in the request header along with required body parameters.

HTTP Status Code: 201 Created

Response Body:

JSON
{
  "success": true,
  "data": {
    "id": "c-501",
    "postId": "p-101",
    "content": "Security check verified.",
    "createdAt": "2026-10-07T11:03:00.000Z"
  }
}
03. What happens when required fields are missing?
Observed Behavior: Sending a payload missing mandatory properties (e.g., missing content or sending {}).

HTTP Status Code: 400 Bad Request

Response Body:

JSON
{
  "error": "Validation Error",
  "details": [
    {
      "field": "content",
      "message": "Content is required."
    }
  ]
}
04. What happens with malformed input?
Observed Behavior: Sending invalid JSON syntax (e.g., trailing commas, unclosed brackets) or unsupported data types.

HTTP Status Code: 400 Bad Request

Response Body:

JSON
{
  "error": "Bad Request",
  "message": "Unexpected end of JSON input"
}
05. What HTTP status is returned — in each case?
Public / Health Check (GET /api/health): 200 OK

Unauthenticated Request: 401 Unauthorized

Missing or Malformed Payload: 400 Bad Request

Insufficient Permissions: 403 Forbidden

Successful Resource Creation: 201 Created

06. What does the response body contain?
Success Responses: Contain a top-level "success": true boolean and return the created/requested object inside a "data" envelope.

Error Responses: Contain a top-level "error" key along with a human-readable "message" or an array of detailed field validation error objects under "details".

07. Where does authentication happen?
Code Pointer: backend/middleware/auth.js

Execution Position: Intercepts incoming requests immediately after global body parsing (express.json()) and CORS middleware, but strictly before routing to protected controller functions.

08. Authentication vs authorization — here, concretely?
Authentication (Identity Check): Handled by authMiddleware inside backend/middleware/auth.js. It validates the JWT signature and extracts the user identity (req.user). Rejects invalid requests with 401 Unauthorized.

Authorization (Permission Check): Handled inside route controller logic or specific role-based guard functions. It verifies if the authenticated user (req.user) possesses permission to edit/delete a given resource or perform administrative actions. Rejects unauthorized requests with 403 Forbidden