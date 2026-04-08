module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const { licenseKey, instanceID } = req.body || {};

    if (!licenseKey || !instanceID) {
      return res.status(400).json({
        ok: false,
        error: "Missing licenseKey or instanceID"
      });
    }

    const lsResponse = await fetch("https://api.lemonsqueezy.com/v1/licenses/deactivate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        license_key: licenseKey,
        instance_id: instanceID
      })
    });

    const text = await lsResponse.text();
    console.log("Lemon deactivate status:", lsResponse.status);
    console.log("Lemon deactivate body:", text);

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return res.status(502).json({
        ok: false,
        error: "Invalid JSON from Lemon Squeezy",
        raw: text
      });
    }

    if (!lsResponse.ok) {
      return res.status(lsResponse.status).json({
        ok: false,
        error: data?.error || "License deactivation failed",
        details: data
      });
    }

    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    console.error("deactivate error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Server error during license deactivation"
    });
  }
};
