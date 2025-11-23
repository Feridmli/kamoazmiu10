import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const MARKETPLACE_CONTRACT_ADDRESS = process.env.SEAPORT_CONTRACT_ADDRESS;
const RPC_LIST = [
  process.env.APECHAIN_RPC,
  "https://rpc.apechain.com/http",
  "https://apechain.drpc.org",
  "https://33139.rpc.thirdweb.com",
];

let providerIndex = 0;
function getProvider() {
  const rpc = RPC_LIST[providerIndex % RPC_LIST.length];
  providerIndex++;
  return new ethers.providers.JsonRpcProvider(rpc);
}

let provider = getProvider();
const nftABI = [
  "function ownerOf(uint256 tokenid) view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function tokenURI(uint256 tokenid) view returns (string)"
];
let nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, nftABI, provider);

function convertIPFStoHTTP(uri) {
  if (!uri) return null;
  return uri.startsWith("ipfs://") ? uri.replace("ipfs://", "https://ipfs.io/ipfs/") : uri;
}

async function processNFT(tokenid) {
  try {
    let owner, tokenURI, success = false;
    for (let i = 0; i < RPC_LIST.length; i++) {
      try {
        owner = await nftContract.ownerOf(tokenid);
        tokenURI = await nftContract.tokenURI(tokenid);
        success = true;
        break;
      } catch (err) {
        if (err.message.includes("owner query for nonexistent token")) return;
        provider = getProvider();
        nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, nftABI, provider);
      }
    }

    if (!success) throw new Error("All RPC endpoints failed");
    const httpURI = convertIPFStoHTTP(tokenURI);
    let name = null;

    try {
      const metadataRes = await fetch(httpURI);
      const metadata = await metadataRes.json();
      name = metadata.name || `Bear #${tokenid}`;
    } catch (e) { name = `Bear #${tokenid}`; }

    const now = new Date().toISOString();
    await supabase.from("metadata").upsert(
      {
        tokenid: tokenid.toString(),
        nft_contract: NFT_CONTRACT_ADDRESS,
        marketplace_contract: MARKETPLACE_CONTRACT_ADDRESS,
        buyer_address: owner.toLowerCase(),
        seaport_order: null,
        order_hash: null,
        on_chain: true,
        name,
        image: httpURI,
        price: 0,
        createdat: now,
        updatedat: now
      },
      { onConflict: "tokenid" }
    );
    console.log(`✅ NFT #${tokenid} saved. Owner: ${owner}, Name: ${name}`);
  } catch (e) { console.warn(`❌ NFT #${tokenid} error:`, e.message); }
}

async function main() {
  try {
    const totalSupply = await nftContract.totalSupply();
    console.log(`🚀 Total minted NFTs: ${totalSupply}`);
    const BATCH_SIZE = 20;

    for (let i = 0; i < totalSupply; i += BATCH_SIZE) {
      const batch = Array.from({ length: BATCH_SIZE }, (_, j) => i + j).filter(id => id < totalSupply);
      await Promise.allSettled(batch.map(tokenid => processNFT(tokenid)));
    }
    console.log("🎉 NFT owners + metadata sync tamamlandı!");
  } catch (err) { console.error("💀 Fatal error:", err.message); process.exit(1); }
}

main();
