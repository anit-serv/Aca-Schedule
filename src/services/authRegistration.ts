interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as ApiErrorBody;

  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Request failed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (error as any).code = data?.error?.code || 'api/unknown-error';
    throw error;
  }

  return data;
}

export const authRegistrationService = {
  async registerPending(email: string, password: string, displayName: string): Promise<void> {
    await requestJson('/api/v1/auth/register-pending', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, displayName }),
    });
  },

  async resendRegistration(email: string): Promise<void> {
    await requestJson('/api/v1/auth/register-resend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });
  },

  async confirmRegistration(idToken: string): Promise<void> {
    await requestJson('/api/v1/auth/register-confirm', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
  },
};
