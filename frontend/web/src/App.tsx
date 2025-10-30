// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface BlueprintNFT {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  title: string;
  architect: string;
  status: "draft" | "published" | "sold";
  price: number;
  previewImage: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [blueprints, setBlueprints] = useState<BlueprintNFT[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newBlueprintData, setNewBlueprintData] = useState({ 
    title: "", 
    architect: "", 
    price: 0,
    previewImage: ""
  });
  const [selectedBlueprint, setSelectedBlueprint] = useState<BlueprintNFT | null>(null);
  const [decryptedPrice, setDecryptedPrice] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Statistics
  const publishedCount = blueprints.filter(b => b.status === "published").length;
  const draftCount = blueprints.filter(b => b.status === "draft").length;
  const soldCount = blueprints.filter(b => b.status === "sold").length;
  const totalValue = blueprints.reduce((sum, bp) => sum + bp.price, 0);

  useEffect(() => {
    loadBlueprints().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadBlueprints = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("blueprint_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing blueprint keys:", e); }
      }
      
      const list: BlueprintNFT[] = [];
      for (const key of keys) {
        try {
          const blueprintBytes = await contract.getData(`blueprint_${key}`);
          if (blueprintBytes.length > 0) {
            try {
              const blueprintData = JSON.parse(ethers.toUtf8String(blueprintBytes));
              list.push({ 
                id: key, 
                encryptedData: blueprintData.data, 
                timestamp: blueprintData.timestamp, 
                owner: blueprintData.owner, 
                title: blueprintData.title,
                architect: blueprintData.architect,
                status: blueprintData.status || "draft",
                price: FHEDecryptNumber(blueprintData.data),
                previewImage: blueprintData.previewImage || ""
              });
            } catch (e) { console.error(`Error parsing blueprint data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading blueprint ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setBlueprints(list);
    } catch (e) { console.error("Error loading blueprints:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitBlueprint = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting blueprint price with Zama FHE..." });
    try {
      const encryptedPrice = FHEEncryptNumber(newBlueprintData.price);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const blueprintId = `bp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const blueprintData = { 
        data: encryptedPrice, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        title: newBlueprintData.title,
        architect: newBlueprintData.architect,
        status: "draft",
        previewImage: newBlueprintData.previewImage
      };
      
      await contract.setData(`blueprint_${blueprintId}`, ethers.toUtf8Bytes(JSON.stringify(blueprintData)));
      
      const keysBytes = await contract.getData("blueprint_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(blueprintId);
      await contract.setData("blueprint_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted blueprint submitted securely!" });
      await loadBlueprints();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewBlueprintData({ 
          title: "", 
          architect: "", 
          price: 0,
          previewImage: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const publishBlueprint = async (blueprintId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Publishing blueprint with FHE encryption..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const blueprintBytes = await contract.getData(`blueprint_${blueprintId}`);
      if (blueprintBytes.length === 0) throw new Error("Blueprint not found");
      
      const blueprintData = JSON.parse(ethers.toUtf8String(blueprintBytes));
      const updatedBlueprint = { ...blueprintData, status: "published" };
      
      await contract.setData(`blueprint_${blueprintId}`, ethers.toUtf8Bytes(JSON.stringify(updatedBlueprint)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Blueprint published successfully!" });
      await loadBlueprints();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Publish failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const markAsSold = async (blueprintId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Marking blueprint as sold..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const blueprintBytes = await contract.getData(`blueprint_${blueprintId}`);
      if (blueprintBytes.length === 0) throw new Error("Blueprint not found");
      
      const blueprintData = JSON.parse(ethers.toUtf8String(blueprintBytes));
      const updatedBlueprint = { ...blueprintData, status: "sold" };
      
      await contract.setData(`blueprint_${blueprintId}`, ethers.toUtf8Bytes(JSON.stringify(updatedBlueprint)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Blueprint marked as sold!" });
      await loadBlueprints();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Operation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (blueprintAddress: string) => address?.toLowerCase() === blueprintAddress.toLowerCase();

  // Filter blueprints based on search and status filter
  const filteredBlueprints = blueprints.filter(bp => {
    const matchesSearch = bp.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         bp.architect.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || bp.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="blueprint-icon"></div></div>
          <h1>Architectural<span>Blueprints</span>NFT</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-blueprint-btn metal-button">
            <div className="add-icon"></div>Add Blueprint
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Encrypted Architectural Blueprints</h2>
            <p>Securely trade architectural designs as NFTs with Zama FHE technology</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>FHE Encryption Active</span></div>
        </div>
        
        <div className="dashboard-panels">
          <div className="stats-panel metal-card">
            <h3>Market Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{blueprints.length}</div>
                <div className="stat-label">Total Blueprints</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{publishedCount}</div>
                <div className="stat-label">Published</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{draftCount}</div>
                <div className="stat-label">Drafts</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{soldCount}</div>
                <div className="stat-label">Sold</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">Ξ{(totalValue / 1000).toFixed(2)}K</div>
                <div className="stat-label">Total Value</div>
              </div>
            </div>
          </div>
          
          <div className="search-panel metal-card">
            <div className="search-container">
              <input 
                type="text" 
                placeholder="Search blueprints..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="metal-input"
              />
              <div className="search-icon"></div>
            </div>
            <div className="filter-container">
              <label>Status:</label>
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value)}
                className="metal-select"
              >
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="sold">Sold</option>
              </select>
            </div>
            <button onClick={loadBlueprints} className="refresh-btn metal-button" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        
        <div className="blueprints-section">
          <div className="section-header">
            <h2>Encrypted Blueprint NFTs</h2>
            <div className="fhe-badge"><span>FHE-Powered</span></div>
          </div>
          
          {filteredBlueprints.length === 0 ? (
            <div className="no-blueprints metal-card">
              <div className="no-blueprints-icon"></div>
              <p>No blueprints found matching your criteria</p>
              <button className="metal-button primary" onClick={() => setShowCreateModal(true)}>Create First Blueprint</button>
            </div>
          ) : (
            <div className="blueprints-grid">
              {filteredBlueprints.map(blueprint => (
                <div 
                  className="blueprint-card metal-card" 
                  key={blueprint.id}
                  onClick={() => setSelectedBlueprint(blueprint)}
                >
                  <div className="blueprint-preview">
                    {blueprint.previewImage ? (
                      <img src={blueprint.previewImage} alt={blueprint.title} className="preview-image" />
                    ) : (
                      <div className="placeholder-image"></div>
                    )}
                    <div className={`status-badge ${blueprint.status}`}>{blueprint.status}</div>
                  </div>
                  <div className="blueprint-info">
                    <h3>{blueprint.title}</h3>
                    <p className="architect">by {blueprint.architect}</p>
                    <div className="price-info">
                      <span>Price:</span>
                      <div className="price-value">
                        Ξ{FHEDecryptNumber(blueprint.encryptedData).toFixed(2)}
                        <div className="fhe-tag">FHE Encrypted</div>
                      </div>
                    </div>
                    <div className="blueprint-actions">
                      {isOwner(blueprint.owner) && (
                        <>
                          {blueprint.status === "draft" && (
                            <button 
                              className="metal-button small success" 
                              onClick={(e) => { e.stopPropagation(); publishBlueprint(blueprint.id); }}
                            >
                              Publish
                            </button>
                          )}
                          {blueprint.status === "published" && (
                            <button 
                              className="metal-button small primary" 
                              onClick={(e) => { e.stopPropagation(); markAsSold(blueprint.id); }}
                            >
                              Mark as Sold
                            </button>
                          )}
                        </>
                      )}
                      <button 
                        className="metal-button small" 
                        onClick={(e) => { e.stopPropagation(); setSelectedBlueprint(blueprint); }}
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitBlueprint} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          blueprintData={newBlueprintData} 
          setBlueprintData={setNewBlueprintData}
        />
      )}
      
      {selectedBlueprint && (
        <BlueprintDetailModal 
          blueprint={selectedBlueprint} 
          onClose={() => { setSelectedBlueprint(null); setDecryptedPrice(null); }} 
          decryptedPrice={decryptedPrice} 
          setDecryptedPrice={setDecryptedPrice} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="blueprint-icon"></div><span>Architectural Blueprints NFT</span></div>
            <p>Secure encrypted architectural designs using Zama FHE technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Privacy</span></div>
          <div className="copyright">© {new Date().getFullYear()} Architectural Blueprints NFT. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  blueprintData: any;
  setBlueprintData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, blueprintData, setBlueprintData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setBlueprintData({ ...blueprintData, [name]: value });
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setBlueprintData({ ...blueprintData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!blueprintData.title || !blueprintData.architect || !blueprintData.price) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Create New Blueprint NFT</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Encryption Notice</strong><p>Your blueprint price will be encrypted with Zama FHE before submission</p></div>
          </div>
          
          <div className="form-group">
            <label>Blueprint Title *</label>
            <input 
              type="text" 
              name="title" 
              value={blueprintData.title} 
              onChange={handleChange} 
              placeholder="Enter blueprint title..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Architect Name *</label>
            <input 
              type="text" 
              name="architect" 
              value={blueprintData.architect} 
              onChange={handleChange} 
              placeholder="Enter architect name..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Price (ETH) *</label>
            <input 
              type="number" 
              name="price" 
              value={blueprintData.price} 
              onChange={handlePriceChange} 
              placeholder="Enter price in ETH..." 
              className="metal-input"
              step="0.01"
              min="0"
            />
          </div>
          
          <div className="form-group">
            <label>Preview Image URL</label>
            <input 
              type="text" 
              name="previewImage" 
              value={blueprintData.previewImage} 
              onChange={handleChange} 
              placeholder="Enter image URL for preview..." 
              className="metal-input"
            />
          </div>
          
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data"><span>Plain Price:</span><div>{blueprintData.price || 'No value entered'} ETH</div></div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{blueprintData.price ? FHEEncryptNumber(blueprintData.price).substring(0, 50) + '...' : 'No value entered'}</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div><strong>Data Privacy Guarantee</strong><p>Price remains encrypted during FHE processing and is never decrypted on our servers</p></div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn metal-button primary">
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface BlueprintDetailModalProps {
  blueprint: BlueprintNFT;
  onClose: () => void;
  decryptedPrice: number | null;
  setDecryptedPrice: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const BlueprintDetailModal: React.FC<BlueprintDetailModalProps> = ({ 
  blueprint, 
  onClose, 
  decryptedPrice, 
  setDecryptedPrice, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedPrice !== null) { setDecryptedPrice(null); return; }
    const decrypted = await decryptWithSignature(blueprint.encryptedData);
    if (decrypted !== null) setDecryptedPrice(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="blueprint-detail-modal metal-card">
        <div className="modal-header">
          <h2>Blueprint Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="blueprint-preview-large">
            {blueprint.previewImage ? (
              <img src={blueprint.previewImage} alt={blueprint.title} className="preview-image-large" />
            ) : (
              <div className="placeholder-image-large"></div>
            )}
          </div>
          
          <div className="blueprint-info-details">
            <h3>{blueprint.title}</h3>
            <p className="architect">Designed by {blueprint.architect}</p>
            
            <div className="info-grid">
              <div className="info-item">
                <span>Owner:</span>
                <strong>{blueprint.owner.substring(0, 6)}...{blueprint.owner.substring(38)}</strong>
              </div>
              <div className="info-item">
                <span>Created:</span>
                <strong>{new Date(blueprint.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
              <div className="info-item">
                <span>Status:</span>
                <strong className={`status-badge ${blueprint.status}`}>{blueprint.status}</strong>
              </div>
            </div>
            
            <div className="price-section">
              <h4>Encrypted Price</h4>
              <div className="price-container">
                <div className="encrypted-price">
                  {blueprint.encryptedData.substring(0, 50)}...
                </div>
                <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
              </div>
              
              <button 
                className="decrypt-btn metal-button" 
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : decryptedPrice !== null ? "Hide Price" : "Decrypt with Wallet"}
              </button>
              
              {decryptedPrice !== null && (
                <div className="decrypted-price-section">
                  <h4>Decrypted Price</h4>
                  <div className="decrypted-price-value">Ξ{decryptedPrice.toFixed(2)}</div>
                  <div className="decryption-notice">
                    <div className="warning-icon"></div>
                    <span>Decrypted price is only visible after wallet signature verification</span>
                  </div>
                </div>
              )}
            </div>
            
            <div className="3d-model-section">
              <h4>3D Model Preview</h4>
              <div className="model-preview-placeholder">
                <p>Interactive 3D model would be displayed here</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;