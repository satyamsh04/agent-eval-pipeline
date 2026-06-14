import 'dotenv/config';
import { createApp } from './api/server';

/**
 * Boots the evaluation API server.
 */
function main(): void {
  const port = Number(process.env.PORT ?? 3000);
  const app = createApp();

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[agent-eval-pipeline] API listening on http://localhost:${port}\n` +
        `  POST /evaluate   GET /metrics   GET /health   GET /prometheus`,
    );
  });
}

main();
