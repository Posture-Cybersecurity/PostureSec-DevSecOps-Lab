--
-- PostgreSQL database dump
--

\restrict m1etZFTzAPOOCyxFTnHWYNSExGm1XpStsWXLoxxjgy7gYwbKPIsGOz5tp5Qzpx9

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: comments; Type: TABLE; Schema: public; Owner: posturesec_user
--

CREATE TABLE public.comments (
    id integer NOT NULL,
    post_id integer,
    author character varying(100) DEFAULT 'Anonymous'::character varying NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    owner_id integer
);


ALTER TABLE public.comments OWNER TO posturesec_user;

--
-- Name: comments_id_seq; Type: SEQUENCE; Schema: public; Owner: posturesec_user
--

CREATE SEQUENCE public.comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.comments_id_seq OWNER TO posturesec_user;

--
-- Name: comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: posturesec_user
--

ALTER SEQUENCE public.comments_id_seq OWNED BY public.comments.id;


--
-- Name: posts; Type: TABLE; Schema: public; Owner: posturesec_user
--

CREATE TABLE public.posts (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    content text NOT NULL,
    author character varying(100) DEFAULT 'Anonymous'::character varying NOT NULL,
    emoji character varying(10) DEFAULT '🛡️'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    owner_id integer
);


ALTER TABLE public.posts OWNER TO posturesec_user;

--
-- Name: posts_id_seq; Type: SEQUENCE; Schema: public; Owner: posturesec_user
--

CREATE SEQUENCE public.posts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.posts_id_seq OWNER TO posturesec_user;

--
-- Name: posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: posturesec_user
--

ALTER SEQUENCE public.posts_id_seq OWNED BY public.posts.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: posturesec_user
--

CREATE TABLE public.sessions (
    id character varying(64) NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone
);


ALTER TABLE public.sessions OWNER TO posturesec_user;

--
-- Name: users; Type: TABLE; Schema: public; Owner: posturesec_user
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(20) DEFAULT 'user'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.users OWNER TO posturesec_user;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: posturesec_user
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO posturesec_user;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: posturesec_user
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: warroom_access_log; Type: TABLE; Schema: public; Owner: posturesec_user
--

CREATE TABLE public.warroom_access_log (
    id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    request_id character varying(40),
    method character varying(10) NOT NULL,
    path text NOT NULL,
    status integer,
    actor_user_id integer,
    actor_email character varying(255),
    session_fp character varying(16),
    ip character varying(64),
    duration_ms integer
);


ALTER TABLE public.warroom_access_log OWNER TO posturesec_user;

--
-- Name: warroom_access_log_id_seq; Type: SEQUENCE; Schema: public; Owner: posturesec_user
--

CREATE SEQUENCE public.warroom_access_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.warroom_access_log_id_seq OWNER TO posturesec_user;

--
-- Name: warroom_access_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: posturesec_user
--

ALTER SEQUENCE public.warroom_access_log_id_seq OWNED BY public.warroom_access_log.id;


--
-- Name: warroom_incident; Type: TABLE; Schema: public; Owner: posturesec_user
--

CREATE TABLE public.warroom_incident (
    id character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'idle'::character varying NOT NULL,
    headline text,
    triggered_at timestamp with time zone,
    contained_at timestamp with time zone,
    resolved_at timestamp with time zone,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.warroom_incident OWNER TO posturesec_user;

--
-- Name: comments id; Type: DEFAULT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.comments ALTER COLUMN id SET DEFAULT nextval('public.comments_id_seq'::regclass);


--
-- Name: posts id; Type: DEFAULT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.posts ALTER COLUMN id SET DEFAULT nextval('public.posts_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: warroom_access_log id; Type: DEFAULT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.warroom_access_log ALTER COLUMN id SET DEFAULT nextval('public.warroom_access_log_id_seq'::regclass);


--
-- Data for Name: comments; Type: TABLE DATA; Schema: public; Owner: posturesec_user
--

COPY public.comments (id, post_id, author, content, created_at, owner_id) FROM stdin;
\.


--
-- Data for Name: posts; Type: TABLE DATA; Schema: public; Owner: posturesec_user
--

COPY public.posts (id, title, content, author, emoji, created_at, updated_at, owner_id) FROM stdin;
2	Q3 Threat Intelligence Briefing	Internal draft — indicators of compromise for the Q3 review. Owned by the author.	A. Victim	🛡️	2026-09-19 09:24:32.626532	2026-09-19 09:24:32.626532	1
1	Q3 Threat Intelligence Briefing	Internal draft — indicators of compromise for the Q3 review. Owned by the author.	A. Victim	🛡️	2026-09-19 08:59:55.351082	2026-09-19 09:26:12.776491	1
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: posturesec_user
--

COPY public.sessions (id, user_id, created_at, expires_at, revoked_at) FROM stdin;
5ef55b52611ff538a0dad44dd86fcaf1805921fb8ccab19ead82d991f8579f37	1	2026-09-19 08:59:55.34045	2026-09-19 16:59:55.34	2026-09-19 09:28:50.945852
94d3588a837e7f5de439f881f8fe521c6da378eebe76b5fefcc6b23c8dcaa251	2	2026-09-19 08:59:55.455379	2026-09-19 16:59:55.454	2026-09-19 09:28:50.945852
7955fb7172eb18d7684337c9f279b7514fecc85b2f91e7675b19b8b33b564be5	1	2026-09-19 09:24:03.007429	2026-09-19 17:24:03.007	2026-09-19 09:28:50.945852
fa88f5ced4c34818871984f87c9183d8b0afdba4ae9a47d7616239da5402212f	2	2026-09-19 09:25:41.970228	2026-09-19 17:25:41.969	2026-09-19 09:28:50.945852
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: posturesec_user
--

COPY public.users (id, email, password_hash, role, created_at) FROM stdin;
1	alice.victim@warroom.local	$2a$10$MrrcnqXsBut7D/esKvkC..N6PizddaSXp217dEAmCw/OHL7KFmLM.	user	2026-09-19 08:59:55.081566
2	mallory.attacker@warroom.local	$2a$10$l7yWtu7tI/BwU3O1F9MXyuG8NAI12XkV.VNTrJyEqhaylonkyUvQO	user	2026-09-19 08:59:55.233498
\.


--
-- Data for Name: warroom_access_log; Type: TABLE DATA; Schema: public; Owner: posturesec_user
--

COPY public.warroom_access_log (id, ts, request_id, method, path, status, actor_user_id, actor_email, session_fp, ip, duration_ms) FROM stdin;
1	2026-09-19 08:54:56.767631+00	req_856c7553745b31405e3ca0ae	GET	/api/health	200	\N	\N	\N	172.20.0.1	6
2	2026-09-19 08:55:06.357737+00	req_090cc6d69f36d494a164b75b	GET	/api/auth/me	401	\N	\N	\N	172.20.0.1	1
3	2026-09-19 08:55:06.381226+00	req_d806e7c1dffbb9655e1a758b	GET	/api/posts	304	\N	\N	\N	172.20.0.1	30
4	2026-09-19 08:59:55.089671+00	req_8e267c4728c05cc544c763e4	POST	/api/auth/register	201	\N	\N	\N	127.0.0.1	113
5	2026-09-19 08:59:55.24335+00	req_c844eb041eae941780dfd2d6	POST	/api/auth/register	201	\N	\N	\N	127.0.0.1	121
6	2026-09-19 08:59:55.344551+00	req_4513ed4d3b2439c28fc6b987	POST	/api/auth/login	200	\N	\N	\N	127.0.0.1	97
7	2026-09-19 08:59:55.353871+00	req_5b5474a7b1ac9c47c45d2edc	POST	/api/posts	201	1	alice.victim@warroom.local	5ef55b52	127.0.0.1	2
8	2026-09-19 08:59:55.459071+00	req_f3344bdf2160fc814c40f9c2	POST	/api/auth/login	200	\N	\N	\N	127.0.0.1	101
9	2026-09-19 08:59:55.473944+00	req_5b397290f15f5a04f88ee0b1	PUT	/api/posts/1	200	2	mallory.attacker@warroom.local	94d3588a	127.0.0.1	6
10	2026-09-19 09:24:03.019554+00	req_5218e596c14fd4582d2abdff	POST	/api/auth/login	200	\N	\N	\N	172.20.0.1	355
11	2026-09-19 09:24:32.647408+00	req_2c799a82887105d5bb518bd4	POST	/api/posts	201	1	alice.victim@warroom.local	7955fb71	172.20.0.1	20
12	2026-09-19 09:25:41.975405+00	req_774757f31be7f340bfc15ef0	POST	/api/auth/login	200	\N	\N	\N	172.20.0.1	295
13	2026-09-19 09:26:12.787971+00	req_d37f2c615368e6cfdd77532f	PUT	/api/posts/1	200	2	mallory.attacker@warroom.local	fa88f5ce	172.20.0.1	11
\.


--
-- Data for Name: warroom_incident; Type: TABLE DATA; Schema: public; Owner: posturesec_user
--

COPY public.warroom_incident (id, status, headline, triggered_at, contained_at, resolved_at, evidence, updated_at) FROM stdin;
INC-001	active	Suspicious activity detected on your blogging platform.	2026-09-19 08:59:55.488531+00	\N	\N	{"symptom": "published content was modified unexpectedly", "_instructor": {"cross_user": true, "tamper_status": 200, "victim_user_id": 1, "content_changed": true, "attacker_user_id": 2}, "observed_at": "2026-09-19T08:59:55.488Z", "affected_resource": "posts", "affected_object_id": 1}	2026-09-19 08:59:55.488531+00
\.


--
-- Name: comments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: posturesec_user
--

SELECT pg_catalog.setval('public.comments_id_seq', 1, false);


--
-- Name: posts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: posturesec_user
--

SELECT pg_catalog.setval('public.posts_id_seq', 2, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: posturesec_user
--

SELECT pg_catalog.setval('public.users_id_seq', 2, true);


--
-- Name: warroom_access_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: posturesec_user
--

SELECT pg_catalog.setval('public.warroom_access_log_id_seq', 13, true);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: warroom_access_log warroom_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.warroom_access_log
    ADD CONSTRAINT warroom_access_log_pkey PRIMARY KEY (id);


--
-- Name: warroom_incident warroom_incident_pkey; Type: CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.warroom_incident
    ADD CONSTRAINT warroom_incident_pkey PRIMARY KEY (id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: posturesec_user
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);


--
-- Name: comments comments_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: comments comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: posts posts_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: posturesec_user
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict m1etZFTzAPOOCyxFTnHWYNSExGm1XpStsWXLoxxjgy7gYwbKPIsGOz5tp5Qzpx9

