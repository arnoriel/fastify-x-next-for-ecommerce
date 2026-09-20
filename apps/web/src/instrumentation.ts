// Jalan sekali saat server Next start → fail fast kalau env salah.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./env");
  }
}
