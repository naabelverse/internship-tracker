declare global {
  namespace Express {
    interface Request {
      /** Correlation id assigned by the requestId middleware and echoed as X-Request-Id. */
      id: string;
    }
  }
}

export {};
