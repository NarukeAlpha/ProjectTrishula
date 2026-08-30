interface WorkOSAccountActions {
  signIn(): Promise<void>;
  signOut(options: { returnTo: string }): Promise<void> | void;
}

export async function changeWorkOSAccount(
  actions: WorkOSAccountActions,
  returnTo: string,
): Promise<void> {
  try {
    await actions.signOut({ returnTo });
  } catch {
    await actions.signIn();
  }
}
