import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('HTTP metrics (integration)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('labels requests by route template, never by concrete URL', async () => {
    const api = () => request(app.getHttpServer());
    await api().get('/work-orders/987654').expect(404);
    await api().get('/no-such-page-123').expect(404);

    const { text } = await api().get('/metrics').expect(200);

    expect(text).toContain(
      'http_requests_total{method="GET",route="/work-orders/:id",status="404"} 1',
    );
    expect(text).toContain(
      'http_requests_total{method="GET",route="unmatched",status="404"} 1',
    );
    // Concrete IDs and paths must never become label values (unbounded cardinality).
    expect(text).not.toContain('987654');
    expect(text).not.toContain('no-such-page-123');
    // Scrapes and health checks are not service traffic.
    expect(text).not.toMatch(/route="\/(metrics|health)"/);
  });
});
