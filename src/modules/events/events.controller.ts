import { Controller, Sse } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { interval, map, merge, type Observable } from "rxjs";
import { CurrentUser, type Claims } from "@/common/auth";
import { EventsService } from "./events.service";

@ApiTags("events") @ApiBearerAuth()
@Controller("events")
export class EventsController {
  constructor(private events: EventsService) {}
  /** `GET /api/events` (Authorization header, or ?access_token= for EventSource which cannot set headers). Heartbeat every 25 s. */
  @Sse()
  stream(@CurrentUser() u: Claims): Observable<{ type: string; data: unknown }> {
    return merge(this.events.forUser(u.sub), interval(25_000).pipe(map(() => ({ type: "ping", data: { at: new Date().toISOString() } }))));
  }
}
