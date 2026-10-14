export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-zinc-900">We could not find that page</h1>
        <p className="mt-2 text-sm text-zinc-600">
          If you opened a pass link, check that you tapped the full link in your WhatsApp message. If it still
          does not work, contact the event helpline.
        </p>
      </div>
    </main>
  );
}
