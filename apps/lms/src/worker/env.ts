export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  LMS_CONTENT_ORIGIN: string;
  STREAM_CUSTOMER_CODE: string;
  CONTENT_SIGNING_SECRET?: string;
  STREAM_SIGNING_KEY_ID?: string;
  STREAM_SIGNING_JWK?: string;
}

export interface Learner {
  accountId: string;
  contactId: string;
  organizationId: string;
  email: string;
  usesDefaultPassword: boolean;
}

export type AppBindings = {
  Bindings: Env;
  Variables: {
    learner: Learner;
  };
};
