/**
 * Next 16 request proxy (the file formerly called `middleware.ts`).
 *
 * When Clerk is configured, every request under /app is protected and
 * unauthenticated visitors are redirected to /sign-in. When it is not,
 * requests pass straight through so the marketing site works with no keys.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextMiddleware } from "next/server";
import { isClerkConfigured } from "@/lib/env";

const isProtectedRoute = createRouteMatcher(["/app(.*)"]);

const passThrough: NextMiddleware = () => NextResponse.next();

const proxy: NextMiddleware = isClerkConfigured()
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedRoute(req)) {
        await auth.protect();
      }
    })
  : passThrough;

export default proxy;

export const config = {
  matcher: [
    // Skip Next internals and static files unless referenced in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
