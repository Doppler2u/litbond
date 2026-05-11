import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { Wallet, Loader2, Info, CheckCircle, AlertCircle, LogOut, TrendingUp, ShieldAlert, ArrowRightLeft } from 'lucide-react'
import LitBondJSON from './LitBond.json'
import MockCollateralJSON from './MockCollateral.json'
import './App.css'

declare global {
  interface Window {
    ethereum?: any;
  }
}

const LITBOND_ADDRESS = "0x2A432b11e719505AbC71b709138db8Ff6646ccF9";
const COLLATERAL_ADDRESS = "0x3300708c404c0DBa6656a52A5C63Aebae7c6af91";

function App() {
  const [account, setAccount] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [contract, setContract] = useState<ethers.Contract | null>(null)
  const [collateralToken, setCollateralToken] = useState<ethers.Contract | null>(null)
  
  const [activeTab, setActiveTab] = useState('earn') // 'earn', 'borrow', 'dashboard'
  
  const [pools, setPools] = useState<any[]>([])
  const [loans, setLoans] = useState<any[]>([])
  const [myDeposits, setMyDeposits] = useState<any[]>([])
  const [myMwbctBalance, setMyMwbctBalance] = useState("0")
  
  const [isFetching, setIsFetching] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null)

  // Inputs
  const [depositAmounts, setDepositAmounts] = useState<Record<number, string>>({})
  const [borrowAmounts, setBorrowAmounts] = useState<Record<number, string>>({})
  const [collateralAmounts, setCollateralAmounts] = useState<Record<number, string>>({})

  useEffect(() => {
    checkConnection()
  }, [])

  useEffect(() => {
    if (contract) {
      fetchData()
    }
  }, [contract])

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  const checkConnection = async () => {
    if (window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum)
      setProvider(provider)
      try {
        const accounts = await provider.send("eth_accounts", [])
        if (accounts.length > 0) {
          setAccount(accounts[0])
          initContract(provider, accounts[0])
        }
      } catch (err) {
        console.error(err)
      }
    }
  }

  const connectWallet = async () => {
    if (!window.ethereum) {
      // Check if user is on a mobile device
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile) {
        // Deep link to MetaMask mobile app browser
        const dappUrl = window.location.href.replace(/^https?:\/\//, '');
        window.location.href = `https://metamask.app.link/dapp/${dappUrl}`;
      } else {
        showToast("Please install MetaMask or another Web3 wallet!", "error");
      }
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const accounts = await provider.send("eth_requestAccounts", [])
      
      const network = await provider.getNetwork();
      if (network.chainId !== 4441n) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x1159' }],
          });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x1159',
                chainName: 'LitVM LiteForge',
                rpcUrls: ['https://liteforge.rpc.caldera.xyz/http'],
                nativeCurrency: { name: 'zkLTC', symbol: 'zkLTC', decimals: 18 },
                blockExplorerUrls: ['https://liteforge.explorer.caldera.xyz']
              }]
            });
          }
        }
      }

      setAccount(accounts[0])
      setProvider(provider)
      initContract(provider, accounts[0])
      showToast("Wallet connected successfully!", "success")
    } catch (err: any) {
      console.error(err)
      showToast("Failed to connect wallet: " + err.message, "error")
    }
  }

  const disconnectWallet = () => {
    setAccount(null)
    setProvider(null)
    setContract(null)
    setCollateralToken(null)
    setPools([])
    setLoans([])
    setMyDeposits([])
    showToast("Wallet disconnected", "success")
  }

  const initContract = async (provider: ethers.BrowserProvider, userAddress: string) => {
    const signer = await provider.getSigner()
    const bondContract = new ethers.Contract(LITBOND_ADDRESS, LitBondJSON.abi, signer)
    const collatContract = new ethers.Contract(COLLATERAL_ADDRESS, MockCollateralJSON.abi, signer)
    
    setContract(bondContract)
    setCollateralToken(collatContract)

    // Mint some dummy collateral if balance is 0 for testing
    try {
       const bal = await collatContract.balanceOf(userAddress);
       setMyMwbctBalance(ethers.formatEther(bal));
       if (bal === 0n) {
         await collatContract.mint(userAddress, ethers.parseEther("1000"));
         showToast("Minted 1000 mWBTC for testing!", "success");
         setMyMwbctBalance("1000.0");
       }
    } catch(e) {}
  }

  const fetchData = async () => {
    if (!contract || !collateralToken || !account || !provider) return;
    setIsFetching(true);
    try {
      const pCounter = await contract.poolCounter();
      const pCount = Number(pCounter);
      const fetchedPools = [];
      const fetchedDeposits = [];

      for (let i = 1; i <= pCount; i++) {
        const p = await contract.pools(i);
        fetchedPools.push({
          id: i,
          durationDays: Number(p.duration) / (24 * 60 * 60),
          fixedAPY: Number(p.fixedAPY) / 100, // 500 = 5%
          totalLiquidity: ethers.formatEther(p.totalLiquidity),
          totalBorrowed: ethers.formatEther(p.totalBorrowed),
          available: ethers.formatEther(p.totalLiquidity - p.totalBorrowed),
          receiptToken: p.receiptToken
        });

        // Fetch user deposit for this pool
        try {
          const receiptContract = new ethers.Contract(p.receiptToken, [
            "function balanceOf(address) view returns (uint256)",
            "function symbol() view returns (string)"
          ], provider);
          
          const bal = await receiptContract.balanceOf(account);
          if (bal > 0n) {
            const sym = await receiptContract.symbol();
            fetchedDeposits.push({
              poolId: i,
              amount: ethers.formatEther(bal),
              symbol: sym,
              durationDays: Number(p.duration) / (24 * 60 * 60),
              fixedAPY: Number(p.fixedAPY) / 100
            });
          }
        } catch(e) {
          console.error("Error fetching deposit for pool", i, e);
        }
      }
      setPools(fetchedPools);
      setMyDeposits(fetchedDeposits);

      const lCounter = await contract.loanCounter();
      const lCount = Number(lCounter);
      const fetchedLoans = [];

      for (let i = 1; i <= lCount; i++) {
        const l = await contract.loans(i);
        if (l.isActive && l.borrower.toLowerCase() === account.toLowerCase()) {
          fetchedLoans.push({
            id: i,
            poolId: Number(l.poolId),
            principal: ethers.formatEther(l.principal),
            interestAmount: ethers.formatEther(l.interestAmount),
            maturityDate: Number(l.maturityDate) * 1000, // JS timestamp
            collateralAmount: ethers.formatEther(l.collateralAmount),
            isActive: l.isActive
          });
        }
      }
      setLoans(fetchedLoans.reverse());
      
      const bal = await collateralToken.balanceOf(account);
      setMyMwbctBalance(ethers.formatEther(bal));

    } catch (err) {
      console.error("Error fetching data:", err);
    }
    setIsFetching(false);
  }

  const handleDeposit = async (poolId: number) => {
    const amount = depositAmounts[poolId];
    if (!contract || !amount || parseFloat(amount) <= 0) return;
    try {
      setProcessingId(`dep-${poolId}`);
      const val = ethers.parseEther(amount);
      const tx = await contract.deposit(poolId, { value: val });
      showToast("Depositing zkLTC...", "success");
      await tx.wait();
      showToast("Deposit successful! Receipt tokens minted.", "success");
      setDepositAmounts({ ...depositAmounts, [poolId]: '' });
      fetchData();
      setActiveTab('dashboard'); // Switch to dashboard to show the deposit
    } catch (err: any) {
      showToast("Error: " + (err.reason || err.message), "error");
    } finally {
      setProcessingId(null);
    }
  }

  const handleWithdraw = async (poolId: number, amountStr: string) => {
    if (!contract) return;
    try {
      setProcessingId(`wth-${poolId}`);
      const val = ethers.parseEther(amountStr);
      const tx = await contract.withdraw(poolId, val);
      showToast("Withdrawing liquidity...", "success");
      await tx.wait();
      showToast("Withdrawal successful!", "success");
      fetchData();
    } catch (err: any) {
      showToast("Error: " + (err.reason || err.message), "error");
    } finally {
      setProcessingId(null);
    }
  }

  const handleBorrow = async (poolId: number) => {
    const bAmt = borrowAmounts[poolId];
    const cAmt = collateralAmounts[poolId];
    if (!contract || !collateralToken || !bAmt || !cAmt) return;
    
    try {
      setProcessingId(`bor-${poolId}`);
      const borrowWei = ethers.parseEther(bAmt);
      const collatWei = ethers.parseEther(cAmt);
      
      showToast("Approving collateral...", "success");
      const approveTx = await collateralToken.approve(LITBOND_ADDRESS, collatWei);
      await approveTx.wait();
      
      showToast("Borrowing zkLTC...", "success");
      const tx = await contract.borrow(poolId, COLLATERAL_ADDRESS, collatWei, borrowWei);
      await tx.wait();
      
      showToast("Loan successful!", "success");
      setBorrowAmounts({ ...borrowAmounts, [poolId]: '' });
      setCollateralAmounts({ ...collateralAmounts, [poolId]: '' });
      fetchData();
      setActiveTab('dashboard');
    } catch (err: any) {
      showToast("Error: " + (err.reason || err.message), "error");
    } finally {
      setProcessingId(null);
    }
  }

  const handleRepay = async (loanId: number, principal: string, interest: string) => {
    if (!contract) return;
    try {
      setProcessingId(`rep-${loanId}`);
      const totalWei = ethers.parseEther(principal) + ethers.parseEther(interest);
      const tx = await contract.repay(loanId, { value: totalWei });
      showToast("Repaying loan...", "success");
      await tx.wait();
      showToast("Loan repaid successfully! Collateral returned.", "success");
      fetchData();
    } catch (err: any) {
      showToast("Error: " + (err.reason || err.message), "error");
    } finally {
      setProcessingId(null);
    }
  }

  const formatAddress = (addr: string) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`

  return (
    <div className="app-container">
      <nav className="navbar">
        <div className="logo">
          <TrendingUp size={28} />
          LitBond
        </div>
        <div className="header-actions">
          <button 
            className={`wallet-btn ${account ? 'connected' : ''}`}
            onClick={account ? undefined : connectWallet}
            style={{ cursor: account ? 'default' : 'pointer' }}
          >
            <Wallet size={18} style={{ marginRight: '0.5rem' }} />
            {account ? formatAddress(account) : 'Connect Wallet'}
          </button>
          
          {account && (
            <button className="disconnect-btn" onClick={disconnectWallet} title="Disconnect Wallet">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </nav>

      <main className="main-content">
        {!account ? (
          <div className="hero">
            <h1>Hard Money Yield on LitVM</h1>
            <p>LitBond is the premier fixed-rate, fixed-term lending protocol. Earn predictable yields on your zkLTC or borrow against your assets without rate volatility.</p>
            <button className="wallet-btn" onClick={connectWallet} style={{ fontSize: '1.2rem', padding: '1rem 2rem', margin: '0 auto' }}>
              Connect Wallet to Enter App
            </button>
          </div>
        ) : (
          <>
            <div className="tabs">
              <button className={`tab ${activeTab === 'earn' ? 'active' : ''}`} onClick={() => setActiveTab('earn')}>
                Earn (Lend)
              </button>
              <button className={`tab ${activeTab === 'borrow' ? 'active' : ''}`} onClick={() => setActiveTab('borrow')}>
                Borrow
              </button>
              <button className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
                My Dashboard
              </button>
            </div>

            {isFetching && pools.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem' }}>
                <Loader2 className="animate-spin" size={32} color="var(--accent-primary)" style={{ margin: '0 auto' }} />
                <p style={{ marginTop: '1rem' }}>Loading markets...</p>
              </div>
            )}

            {activeTab === 'earn' && !isFetching && (
              <div>
                <h2 style={{ marginBottom: '2rem' }}>Fixed-Rate Term Pools</h2>
                <div className="dashboard-grid">
                  {pools.map(pool => (
                    <div className="card" key={pool.id}>
                      <div className="card-header">
                        <h3 className="card-title">{pool.durationDays}-Day Term</h3>
                        <span className="badge">{pool.fixedAPY.toFixed(2)}% APY</span>
                      </div>
                      
                      <div className="stat-row">
                        <span>Pool TVL:</span>
                        <strong>{parseFloat(pool.totalLiquidity).toFixed(4)} zkLTC</strong>
                      </div>
                      <div className="stat-row">
                        <span>Total Borrowed:</span>
                        <strong>{parseFloat(pool.totalBorrowed).toFixed(4)} zkLTC</strong>
                      </div>
                      
                      <div style={{ marginTop: '2rem' }}>
                        <div className="form-group" style={{ marginBottom: '0' }}>
                          <label>Deposit Amount (zkLTC)</label>
                          <input 
                            type="number" 
                            placeholder="0.00" 
                            min="0"
                            value={depositAmounts[pool.id] || ''}
                            onChange={e => setDepositAmounts({...depositAmounts, [pool.id]: e.target.value})}
                          />
                        </div>
                        <button 
                          className="action-btn primary"
                          disabled={processingId !== null || !depositAmounts[pool.id]}
                          onClick={() => handleDeposit(pool.id)}
                        >
                          {processingId === `dep-${pool.id}` ? <Loader2 className="animate-spin" /> : 'Deposit & Mint Receipt'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'borrow' && !isFetching && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                  <h2>Borrow zkLTC at Fixed Rates</h2>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Your Collateral Balance: <strong style={{ color: 'var(--text-primary)' }}>{parseFloat(myMwbctBalance).toFixed(2)} mWBTC</strong>
                  </div>
                </div>
                
                <div className="dashboard-grid">
                  {pools.map(pool => (
                    <div className="card" key={pool.id}>
                      <div className="card-header">
                        <h3 className="card-title">{pool.durationDays}-Day Term</h3>
                        <span className="badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)' }}>{pool.fixedAPY.toFixed(2)}% APR</span>
                      </div>
                      
                      <div className="stat-row">
                        <span>Available Liquidity:</span>
                        <strong style={{ color: 'var(--success)' }}>{parseFloat(pool.available).toFixed(4)} zkLTC</strong>
                      </div>
                      
                      <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div className="form-group" style={{ marginBottom: '0' }}>
                          <label>Borrow Amount (zkLTC)</label>
                          <input 
                            type="number" 
                            placeholder="0.00" 
                            value={borrowAmounts[pool.id] || ''}
                            onChange={e => setBorrowAmounts({...borrowAmounts, [pool.id]: e.target.value})}
                          />
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'center', margin: '0.25rem 0' }}>
                          <ArrowRightLeft size={16} color="var(--text-secondary)" style={{ transform: 'rotate(90deg)' }} />
                        </div>
                        
                        <div className="form-group" style={{ marginBottom: '0' }}>
                          <label style={{ display: 'flex', alignItems: 'center' }}>
                            Collateral to Lock (mWBTC)
                            <div className="tooltip-wrapper">
                              <Info size={14} color="var(--text-secondary)" />
                              <div className="tooltip-text">Must maintain 150% collateral ratio based on internal oracle price (1 mWBTC = 100 zkLTC).</div>
                            </div>
                          </label>
                          <input 
                            type="number" 
                            placeholder="0.00" 
                            value={collateralAmounts[pool.id] || ''}
                            onChange={e => setCollateralAmounts({...collateralAmounts, [pool.id]: e.target.value})}
                          />
                        </div>

                        <button 
                          className="action-btn"
                          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                          disabled={processingId !== null || !borrowAmounts[pool.id] || !collateralAmounts[pool.id]}
                          onClick={() => handleBorrow(pool.id)}
                        >
                          {processingId === `bor-${pool.id}` ? <Loader2 className="animate-spin" /> : 'Approve & Borrow'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'dashboard' && !isFetching && (
              <div>
                <h2 style={{ marginBottom: '2rem' }}>My Lending Positions (Deposits)</h2>
                {myDeposits.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', backgroundColor: 'var(--bg-card)', borderRadius: '1rem', border: '1px solid var(--border-color)', marginBottom: '3rem' }}>
                    <p style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>You don't have any active deposits.</p>
                  </div>
                ) : (
                  <div className="dashboard-grid" style={{ marginBottom: '3rem' }}>
                    {myDeposits.map((dep, idx) => (
                      <div className="card" key={idx}>
                        <div className="card-header">
                          <h3 className="card-title">Pool #{dep.poolId} ({dep.durationDays}D Term)</h3>
                          <span className="badge" style={{ backgroundColor: 'var(--success)', color: 'var(--bg-dark)' }}>Active</span>
                        </div>
                        <div className="stat-row">
                          <span>Receipt Tokens:</span>
                          <strong>{parseFloat(dep.amount).toFixed(4)} {dep.symbol}</strong>
                        </div>
                        <div className="stat-row">
                          <span>Fixed APY:</span>
                          <strong>{dep.fixedAPY.toFixed(2)}%</strong>
                        </div>
                        <button 
                          className="action-btn"
                          disabled={processingId !== null}
                          onClick={() => handleWithdraw(dep.poolId, dep.amount)}
                        >
                          {processingId === `wth-${dep.poolId}` ? <Loader2 className="animate-spin" /> : 'Withdraw Liquidity'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <h2 style={{ marginBottom: '2rem' }}>My Active Loans (Borrowing)</h2>
                {loans.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--bg-card)', borderRadius: '1rem', border: '1px solid var(--border-color)' }}>
                    <ShieldAlert size={48} color="var(--text-secondary)" style={{ margin: '0 auto 1rem', display: 'block' }} />
                    <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }}>You don't have any active loans.</p>
                  </div>
                ) : (
                  <div className="dashboard-grid">
                    {loans.map(loan => {
                      const pool = pools.find(p => p.id === loan.poolId);
                      const isExpired = Date.now() > loan.maturityDate;
                      
                      return (
                        <div className="card" key={loan.id} style={{ border: isExpired ? '1px solid var(--danger)' : '' }}>
                          <div className="card-header">
                            <h3 className="card-title">Loan #{loan.id} ({pool?.durationDays}D Term)</h3>
                            <span className="badge" style={{ backgroundColor: isExpired ? 'var(--danger)' : 'var(--success)', color: isExpired ? 'white' : 'var(--bg-dark)' }}>
                              {isExpired ? 'Expired / Liq Risk' : 'Healthy'}
                            </span>
                          </div>
                          
                          <div className="stat-row">
                            <span>Principal Borrowed:</span>
                            <strong>{parseFloat(loan.principal).toFixed(4)} zkLTC</strong>
                          </div>
                          <div className="stat-row">
                            <span>Fixed Interest Due:</span>
                            <strong>{parseFloat(loan.interestAmount).toFixed(6)} zkLTC</strong>
                          </div>
                          <div className="stat-row" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                            <span>Total to Repay:</span>
                            <strong style={{ color: 'var(--danger)' }}>{(parseFloat(loan.principal) + parseFloat(loan.interestAmount)).toFixed(6)} zkLTC</strong>
                          </div>
                          
                          <div className="stat-row" style={{ marginTop: '1rem' }}>
                            <span>Locked Collateral:</span>
                            <strong>{parseFloat(loan.collateralAmount).toFixed(4)} mWBTC</strong>
                          </div>
                          
                          <div className="stat-row" style={{ fontSize: '0.85rem' }}>
                            <span>Maturity Date:</span>
                            <strong style={{ color: isExpired ? 'var(--danger)' : 'var(--text-primary)' }}>
                              {new Date(loan.maturityDate).toLocaleString()}
                            </strong>
                          </div>
                          
                          <button 
                            className="action-btn primary"
                            disabled={processingId !== null}
                            onClick={() => handleRepay(loan.id, loan.principal, loan.interestAmount)}
                          >
                            {processingId === `rep-${loan.id}` ? <Loader2 className="animate-spin" /> : 'Repay & Unlock Collateral'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
