import express from "express";
import cors from "cors";
import helmet from "helmet";
import { nanoid } from "nanoid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

app.get("/", (req, res) => {
  const indexFile = fs.existsSync(path.join(distPath, "index.html"))
    ? path.join(distPath, "index.html")
    : path.join(__dirname, "index.html");
  res.sendFile(indexFile);
});

app.get("/api/status", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/nfts", async (req, res) => {
  try {
    const { data, error } = await supabase.from("metadata").select("*").order("tokenid", { ascending: true });
    if (error) throw error;
    res.json({ success: true, nfts: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/order", async (req, res) => {
  try {
    const { tokenid, price, seller_address, buyer_address, seaport_order, order_hash, image, status = "active" } = req.body;
    if (!seller_address || !seaport_order || !order_hash) return res.status(400).json({ success: false, error: "Missing seller_address, seaport_order or order_hash" });

    const id = nanoid();
    const now = new Date().toISOString();
    const { error } = await supabase.from("orders").upsert(
      {
        id,
        tokenid: tokenid?.toString() || null,
        price: price || null,
        nft_contract: process.env.NFT_CONTRACT_ADDRESS,
        marketplace_contract: process.env.SEAPORT_CONTRACT_ADDRESS,
        seller_address: seller_address.toLowerCase(),
        buyer_address: buyer_address?.toLowerCase() || null,
        seaport_order,
        order_hash,
        on_chain: !!buyer_address,
        status,
        image: image || null,
        createdat: now,
        updatedat: now,
      },
      { onConflict: "order_hash" }
    );

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const { data, error } = await supabase.from("orders").select("*").order("createdat", { ascending: false }).limit(500);
    if (error) throw error;
    res.json({ success: true, orders: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/buy", async (req, res) => {
  try {
    const { order_hash, buyer_address } = req.body;
    if (!order_hash || !buyer_address) return res.status(400).json({ success: false, error: "Missing order_hash or buyer_address" });

    const { data, error } = await supabase.from("orders")
      .update({ on_chain: true, buyer_address: buyer_address.toLowerCase(), status: "fulfilled", updatedat: new Date().toISOString() })
      .eq("order_hash", order_hash).select();

    if (error) throw error;
    res.json({ success: true, order: data[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.listen(PORT, () => console.log(`🚀 Backend ${PORT}-də işləyir`));
