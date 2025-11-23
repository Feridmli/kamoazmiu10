import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT;
const SEAPORT_CONTRACT_ADDRESS = import.meta.env.VITE_SEAPORT_CONTRACT;

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";

let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");

function notify(msg, timeout = 3500) {
  noticeDiv.textContent = msg;
  if (timeout) setTimeout(() => { if (noticeDiv.textContent === msg) noticeDiv.textContent = ""; }, timeout);
}

async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask tapılmadı!");
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    userAddress = (await signer.getAddress()).toLowerCase();

    const network = await provider.getNetwork();
    if (network.chainId !== APECHAIN_ID) {
      await provider.send("wallet_addEthereumChain", [{
        chainId: APECHAIN_ID_HEX,
        chainName: "ApeChain Mainnet",
        nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
        rpcUrls: ["https://rpc.apechain.com"],
        blockExplorerUrls: ["https://apescan.io"]
      }]);
      notify("Şəbəkə əlavə edildi, yenidən qoşun.");
      return;
    }

    seaport = new Seaport(signer, { contractAddress: SEAPORT_CONTRACT_ADDRESS });
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = userAddress.slice(0, 6) + "..." + userAddress.slice(-4);
    await loadNFTs();
  } catch (err) { console.error(err); alert("Wallet connect xətası!"); }
}

disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";
  notify("Cüzdan ayırıldı", 2000);
};
connectBtn.onclick = connectWallet;

let loadingNFTs = false;
let loadedCount = 0;
const BATCH_SIZE = 12;
let allNFTs = [];

async function loadNFTs() {
  if (loadingNFTs) return;
  loadingNFTs = true;

  try {
    if (allNFTs.length === 0) {
      const res = await fetch(`${BACKEND_URL}/api/nfts`);
      const data = await res.json();
      allNFTs = data.nfts || [];
    }

    if (loadedCount >= allNFTs.length) {
      if (loadedCount === 0) marketplaceDiv.innerHTML = "<p>Bu səhifədə NFT yoxdur.</p>";
      return;
    }

    const batch = allNFTs.slice(loadedCount, loadedCount + BATCH_SIZE);
    loadedCount += batch.length;

    for (const nft of batch) {
      const tokenid = nft.tokenid;
      const name = nft.name || `Bear #${tokenid}`;
      let image = nft.image || "https://ipfs.io/ipfs/QmExampleNFTImage/default.png";
      if (image.startsWith("ipfs://")) image = image.replace("ipfs://", "https://ipfs.io/ipfs/");

      const card = document.createElement("div");
      card.className = "nft-card";
      card.innerHTML = `
        <img src="${image}" alt="NFT image"
          onerror="this.src='https://ipfs.io/ipfs/QmExampleNFTImage/default.png'">
        <h4>${name}</h4>
        <p class="price">Qiymət: ${nft.price || '-' } APE</p>
        <div class="nft-actions">
          <input type="number" min="0" step="0.01" class="price-input" placeholder="Qiymət (APE)">
          <button class="wallet-btn buy-btn" data-id="${tokenid}">Buy</button>
          <button class="wallet-btn list-btn" data-token="${tokenid}">List</button>
        </div>
      `;
      marketplaceDiv.appendChild(card);

      card.querySelector(".buy-btn").onclick = async (ev) => {
        ev.target.disabled = true;
        await buyNFT(nft).catch(console.error);
        ev.target.disabled = false;
      };

      card.querySelector(".list-btn").onclick = async (ev) => {
        ev.target.disabled = true;
        const priceInput = card.querySelector(".price-input");
        const price = parseFloat(priceInput.value);
        if (!price || isNaN(price)) {
          notify("Qiymət düzgün deyil, listing ləğv edildi.");
          ev.target.disabled = false;
          return;
        }
        await listNFT(tokenid, price, card).catch(console.error);
        ev.target.disabled = false;
      };
    }
  } catch (err) { console.error(err); if (loadedCount === 0) marketplaceDiv.innerHTML = "<p>Xəta baş verdi.</p>"; }
  finally { loadingNFTs = false; }
}

window.addEventListener("scroll", () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 300) loadNFTs();
});

async function buyNFT(nftRecord) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  notify("Alış hazırlanır...");

  const rawOrder = nftRecord.seaport_order || JSON.parse(nftRecord.seaportOrderJSON || "{}");
  if (!rawOrder || Object.keys(rawOrder).length === 0) return alert("Order boşdur!");

  try {
    const buyer = await signer.getAddress();
    notify("Transaction göndərilir...");
    const result = await seaport.fulfillOrder({ order: rawOrder, accountAddress: buyer });
    const tx = await (result.executeAllActions || result.execute)();
    await tx.wait();

    notify("NFT alındı! ✅");

    await fetch(`${BACKEND_URL}/api/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenid: nftRecord.tokenid,
        nft_contract: NFT_CONTRACT_ADDRESS,
        marketplace_contract: SEAPORT_CONTRACT_ADDRESS,
        buyer_address: buyer,
        seaport_order: rawOrder,
        order_hash: nftRecord.order_hash || null,
        on_chain: true
      })
    });

    loadedCount = 0;
    allNFTs = [];
    marketplaceDiv.innerHTML = "";
    loadNFTs();
  } catch (err) { console.error(err); alert("Buy xətası: " + err.message); }
}

async function listNFT(tokenid, price, card) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  const seller = await signer.getAddress();

  const nftContract = new ethers.Contract(
    NFT_CONTRACT_ADDRESS,
    [
      "function ownerOf(uint256) view returns (address)",
      "function isApprovedForAll(address owner, address operator) view returns (bool)",
      "function setApprovalForAll(address operator, bool approved)"
    ],
    signer
  );

  notify("Sahiblik yoxlanılır...");
  const owner = (await nftContract.ownerOf(tokenid)).toLowerCase();
  if (owner !== seller.toLowerCase()) return alert("Bu NFT sənin deyil!");

  const priceWei = ethers.utils.parseEther(price.toString());
  const approved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
  if (!approved) {
    notify("Approve göndərilir...");
    const tx = await nftContract.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
    await tx.wait();
  }

  notify("Seaport order yaradılır...");
  const createReq = {
    offer: [{ itemType: 2, token: NFT_CONTRACT_ADDRESS, identifier: tokenid.toString() }],
    consideration: [{ amount: priceWei.toString(), recipient: seller }],
    endTime: (Math.floor(Date.now() / 1000) + 86400 * 30).toString()
  };
  const orderResult = await seaport.createOrder(createReq, seller);
  const signed = await (orderResult.executeAllActions || orderResult.execute)();
  const signedOrder = signed.order || signed;

  const orderHash = signedOrder.orderHash || null;

  notify("Order backend-ə göndərilir...");
  const res = await fetch(`${BACKEND_URL}/api/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenid,
      price,
      nft_contract: NFT_CONTRACT_ADDRESS,
      marketplace_contract: SEAPORT_CONTRACT_ADDRESS,
      buyer_address: null,
      seaport_order: signed,
      order_hash: orderHash,
      on_chain: false,
      createdat: new Date().toISOString(),
      updatedat: new Date().toISOString()
    })
  });

  const j = await res.json();
  if (!j.success) return alert("Backend order-u qəbul etmədi!");
  card.querySelector('.price').textContent = `Qiymət: ${price} APE`;

  notify(`NFT #${tokenid} list olundu — ${price} APE`);
  loadedCount = 0;
  allNFTs = [];
  marketplaceDiv.innerHTML = "";
  loadNFTs();
}

window.buyNFT = buyNFT;
window.listNFT = listNFT;
window.loadNFTs = loadNFTs;
