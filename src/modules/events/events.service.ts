import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Client } from "pg";
import { Subject, filter, map, type Observable } from "rxjs";
import { APP_CONFIG } from "@/config/config.module";
import type { AppConfig } from "@/config/config.schema";

export interface AppEvent { type: string; table: string; op: string; id: string; user_ids: string[]; at: string }

/**
 * Replaces Supabase Realtime. One dedicated connection LISTENs on `app_events` (fed by the app_events_notify()
 * triggers) and fans each payload out to the SSE streams of the users named in `user_ids`. Works across several
 * API instances because the source of truth is the database, not process memory.
 */
@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(EventsService.name);
  private client?: Client;
  private readonly subject = new Subject<AppEvent>();
  private stopped = false;

  constructor(@Inject(APP_CONFIG) private cfg: AppConfig) {}

  async onModuleInit() { await this.connect(); }
  async onModuleDestroy() { this.stopped = true; await this.client?.end().catch(() => undefined); }

  private async connect() {
    if (this.stopped) return;
    const c = new Client({ connectionString: this.cfg.DATABASE_URL });
    c.on("notification", (n) => {
      try { this.subject.next(JSON.parse(n.payload ?? "{}") as AppEvent); } catch (e) { this.log.warn(`bad payload: ${(e as Error).message}`); }
    });
    c.on("error", (e) => { this.log.error(`listener error: ${e.message}`); });
    c.on("end", () => { if (!this.stopped) { this.log.warn("listener disconnected; reconnecting in 2s"); setTimeout(() => this.connect(), 2000); } });
    await c.connect();
    await c.query("LISTEN app_events");
    this.client = c;
    this.log.log("LISTEN app_events");
  }

  /** Per-user stream in SSE shape. */
  forUser(userId: string): Observable<{ type: string; data: AppEvent }> {
    return this.subject.pipe(filter((e) => Array.isArray(e.user_ids) && e.user_ids.includes(userId)), map((e) => ({ type: e.type, data: e })));
  }
}
