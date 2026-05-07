## Create `src/config/keys.ts`

Create a new file at `src/config/keys.ts` containing the Mapbox public token from earlier in the chat. Public Mapbox tokens (`pk.*`) are designed to be exposed client-side, so storing in source is safe.

File contents:

```ts
// Mapbox public token — safe to be in source code (public token, not secret)
export const MAPBOX_TOKEN = 'pk.eyJ1IjoiZ2FoZXJlZGlhIiwiYSI6ImNtb3ZuN2plYzA4eWUyc3E0YTVrbGQwcGsifQ.2eXHla81liSzFSYggN2y_Q';
```

No other files will be modified. After creating, I'll confirm the file exists at `src/config/keys.ts`.
