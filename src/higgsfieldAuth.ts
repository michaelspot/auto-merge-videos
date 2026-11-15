import { AuthRequest, exchangeCodeAsync, refreshAsync, revokeAsync, TokenResponse, TokenTypeHint, type TokenResponseConfig } from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

// Public native OAuth client registered with Higgsfield's advertised issuer.
// This is a client identifier, not an API key or a client secret.
const CLIENT_ID = 'WrbjAp42MnszA9Ih';
const ISSUER = 'https://clerk.higgsfield.ai';
const REDIRECT_URI = 'scaylit://higgsfield/callback';
const RESOURCE = 'https://mcp.higgsfield.ai/mcp';
const SESSION_KEY = 'scaylit.higgsfield.oauth.v1';
const STORE_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const discovery = {
  authorizationEndpoint: `${ISSUER}/oauth/authorize`,
  tokenEndpoint: `${ISSUER}/oauth/token`,
  revocationEndpoint: `${ISSUER}/oauth/token/revoke`,
};

let refreshInFlight: Promise<string> | null = null;
let sessionVersion = 0;

export async function readHiggsfieldSession(): Promise<TokenResponseConfig | null> {
  const value = await SecureStore.getItemAsync(SESSION_KEY, STORE_OPTIONS);
  if (!value) return null;
  try {
    const session = JSON.parse(value) as TokenResponseConfig;
    return typeof session.accessToken === 'string' && session.accessToken ? session : null;
  } catch { return null; }
}

export async function connectHiggsfield() {
  const request = new AuthRequest({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: ['openid', 'email', 'offline_access'],
    usePKCE: true,
    extraParams: { resource: RESOURCE },
  });
  const result = await request.promptAsync(discovery);
  if (result.type === 'cancel' || result.type === 'dismiss') return false;
  if (result.type !== 'success' || !result.params.code || !request.codeVerifier) {
    throw new Error('La connexion Higgsfield n’a pas été autorisée. Réessaie.');
  }
  if (result.params.iss && result.params.iss !== ISSUER) {
    throw new Error('Le retour de connexion Higgsfield est invalide.');
  }
  const token = await exchangeCodeAsync({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    code: result.params.code,
    extraParams: { code_verifier: request.codeVerifier, resource: RESOURCE },
  }, discovery);
  if (!token.accessToken) throw new Error('Higgsfield n’a pas renvoyé de session.');
  sessionVersion += 1;
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(token.getRequestConfig()), STORE_OPTIONS);
  return true;
}

export async function getHiggsfieldToken(forceRefresh = false): Promise<string> {
  const session = await readHiggsfieldSession();
  if (!session) throw new Error('Connecte ton compte Higgsfield pour continuer.');
  if (!forceRefresh && TokenResponse.isTokenFresh({ ...session, issuedAt: session.issuedAt ?? 0 }, 60)) return session.accessToken;
  if (!session.refreshToken) throw new Error('Ta connexion Higgsfield a expiré. Reconnecte ton compte.');
  if (refreshInFlight) return refreshInFlight;
  const version = sessionVersion;
  refreshInFlight = (async () => {
    try {
      const token = await refreshAsync({
        clientId: CLIENT_ID, refreshToken: session.refreshToken,
        extraParams: { resource: RESOURCE },
      }, discovery);
      if (version !== sessionVersion) throw new Error('Le compte Higgsfield a changé.');
      const next = { ...token.getRequestConfig(), refreshToken: token.refreshToken || session.refreshToken };
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next), STORE_OPTIONS);
      return token.accessToken;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'invalid_grant') {
        if (version === sessionVersion) await SecureStore.deleteItemAsync(SESSION_KEY, STORE_OPTIONS);
        throw new Error('Ta connexion Higgsfield a expiré. Reconnecte ton compte.');
      }
      throw error;
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function disconnectHiggsfield() {
  const session = await readHiggsfieldSession();
  sessionVersion += 1;
  await SecureStore.deleteItemAsync(SESSION_KEY, STORE_OPTIONS);
  if (session) {
    await Promise.allSettled([
      revokeAsync({ clientId: CLIENT_ID, token: session.accessToken, tokenTypeHint: TokenTypeHint.AccessToken }, discovery),
      ...(session.refreshToken ? [revokeAsync({ clientId: CLIENT_ID, token: session.refreshToken, tokenTypeHint: TokenTypeHint.RefreshToken }, discovery)] : []),
    ]);
  }
}
