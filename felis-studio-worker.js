/**
 * Felis Studio — Cloudflare Worker
 *
 * Proxies image generation requests to fal.ai (Nano Banana Pro / Google Gemini)
 * so the FAL_KEY never touches the browser.
 *
 * Environment variables (set via `wrangler secret put FAL_KEY`):
 *   FAL_KEY — fal.ai API key
 *
 * Endpoints:
 *   POST /api/glamour
 *     body: { catImage: "<base64>", peopleImages: ["<base64>", ...], peopleCount: <n> }
 *     resp: { imageUrl: "https://..." }
 */

const FAL_MODEL_ENDPOINT = "https://fal.run/fal-ai/nano-banana/edit";

// Allow the Cafe24 storefront + any preview/staging origins. Tighten as needed.
const ALLOWED_ORIGINS = [
  "https://drfelis.com",
  "https://www.drfelis.com",
  "https://drfelis.cafe24.com",
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    },
  });
}

/**
 * Accepts either a raw base64 string or an already-formed data URI and
 * returns a data URI suitable for fal.ai's image_urls field.
 */
function toDataUri(input) {
  if (typeof input !== "string" || input.length === 0) return null;
  if (input.startsWith("data:")) return input;
  // Default to JPEG; fal.ai tolerates jpeg/png/webp data URIs.
  return `data:image/jpeg;base64,${input}`;
}

function buildPrompt(peopleCount) {
  const n = Number.isFinite(peopleCount) && peopleCount > 0 ? peopleCount : 1;
  return (
    `Professional glamour photography studio portrait. ` +
    `A black cat with a white muzzle and fluffy cheeks sits elegantly with ${n} family members. ` +
    `Soft studio lighting with golden rim light, luxurious bokeh background in warm cream tones, ` +
    `Vogue-style composition, shot on medium format camera, high-end retouching, cinematic color grading.`
  );
}

async function handleGlamour(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (_err) {
    return jsonResponse({ error: "Invalid JSON body" }, 400, request);
  }

  const { catImage, peopleImages, peopleCount } = payload || {};

  if (!catImage) {
    return jsonResponse({ error: "catImage is required" }, 400, request);
  }
  if (!Array.isArray(peopleImages) || peopleImages.length === 0) {
    return jsonResponse({ error: "peopleImages must be a non-empty array" }, 400, request);
  }
  if (peopleImages.length > 5) {
    return jsonResponse({ error: "peopleImages supports up to 5 images" }, 400, request);
  }

  const imageUrls = [toDataUri(catImage), ...peopleImages.map(toDataUri)].filter(Boolean);
  if (imageUrls.length < 2) {
    return jsonResponse({ error: "Could not decode reference images" }, 400, request);
  }

  if (!env.FAL_KEY) {
    return jsonResponse({ error: "Server misconfigured: FAL_KEY missing" }, 500, request);
  }

  const falBody = {
    prompt: buildPrompt(peopleCount),
    image_urls: imageUrls,
    num_images: 1,
    output_format: "jpeg",
  };

  let falResp;
  try {
    falResp = await fetch(FAL_MODEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Key ${env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(falBody),
    });
  } catch (err) {
    return jsonResponse({ error: "Upstream request failed", detail: String(err) }, 502, request);
  }

  if (!falResp.ok) {
    const text = await falResp.text();
    return jsonResponse(
      { error: "fal.ai request failed", status: falResp.status, detail: text.slice(0, 500) },
      502,
      request
    );
  }

  let falJson;
  try {
    falJson = await falResp.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid upstream response" }, 502, request);
  }

  // fal-ai/nano-banana/edit returns { images: [{ url, ... }], ... }
  const imageUrl = falJson?.images?.[0]?.url;
  if (!imageUrl) {
    return jsonResponse({ error: "No image returned", raw: falJson }, 502, request);
  }

  return jsonResponse({ imageUrl }, 200, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === "/api/glamour" && request.method === "POST") {
      return handleGlamour(request, env);
    }

    return jsonResponse({ error: "Not found" }, 404, request);
  },
};
