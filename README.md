# CampusMind

CampusMind is a multi-agent learning platform prototype for university students. It includes student sign-in, a personal DeepSeek-powered learning agent, course resources, weekly plans, a forum, and a timetable that imports Jilin University course-table PDFs.

## Local development

Start the backend in one terminal:

```powershell
cd server
npm.cmd run dev
```

Start the frontend in a second terminal:

```powershell
npm.cmd run dev
```

Then open `http://localhost:5174`.

## Production deployment

The Docker, Nginx, data-persistence, and Ubuntu ECS instructions are in [DEPLOY.md](DEPLOY.md).

Never commit `server/.env`, SQLite databases, API keys, or real student data.
