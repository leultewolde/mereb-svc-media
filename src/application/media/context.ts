export interface AuthenticatedPrincipal {
  userId: string;
}

export interface MediaExecutionContext {
  principal?: AuthenticatedPrincipal;
}
