# Render deployment

1. Create a Render account and connect the repository containing this project.
2. Render will detect `render.yaml`.
3. Set these environment variables in Render:
   - ADMIN_EMAIL
   - ADMIN_PASSWORD
   - OPENAI_API_KEY (optional, for AI image extraction)
4. Deploy the service.
5. The app listens on the PORT supplied by Render.

Important: the current app uses a JSON file for persistence. This is suitable for testing/prototyping, not a robust production database. Automatic payment gateway integration also still requires merchant credentials.
