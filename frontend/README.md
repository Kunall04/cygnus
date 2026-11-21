# Cygnus frontend

The dashboard provides the landing page at `/` and the deployment console at `/deploy`.

## Development

Use Node.js 24. From this directory, run:

```sh
npm ci
npm run dev
```

Start the backend services using the [project setup guide](../README.md).

## Production build

```sh
npm run build
npm run preview
```

The production files are written to `dist/`.
