export async function onRequest() {
  return new Response(
    JSON.stringify({
      error: "SSE event streaming is deprecated. Please use the lightweight /api/versions endpoint for updates.",
      status: 410
    }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
}
