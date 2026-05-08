// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ReceiptToken is ERC20 {
    address public pool;
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        pool = msg.sender;
    }
    function mint(address to, uint256 amount) external {
        require(msg.sender == pool, "Only pool can mint");
        _mint(to, amount);
    }
    function burn(address from, uint256 amount) external {
        require(msg.sender == pool, "Only pool can burn");
        _burn(from, amount);
    }
}

contract MockCollateral is ERC20 {
    constructor() ERC20("Mock WBTC", "mWBTC") {
        _mint(msg.sender, 1000000 * 10 ** 18);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LitBond is Ownable {
    struct Pool {
        uint256 duration;
        uint256 fixedAPY; // in basis points, e.g., 500 = 5%
        uint256 totalLiquidity;
        uint256 totalBorrowed;
        address receiptToken;
    }

    struct Loan {
        uint256 poolId;
        address borrower;
        uint256 principal;
        uint256 interestAmount;
        uint256 maturityDate;
        address collateralToken;
        uint256 collateralAmount;
        bool isActive;
    }

    uint256 public poolCounter;
    uint256 public loanCounter;
    
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => Loan) public loans;
    mapping(address => bool) public whitelistedCollateral;
    
    // Simplistic oracle: token address => price in native token (zkLTC)
    mapping(address => uint256) public collateralPrices;

    uint256 public constant COLLATERAL_RATIO = 150; // 150% required
    uint256 public constant LIQUIDATION_THRESHOLD = 110; // 110% to liquidate

    event PoolCreated(uint256 poolId, uint256 duration, uint256 fixedAPY, address receiptToken);
    event Deposited(uint256 poolId, address lender, uint256 amount);
    event Borrowed(uint256 loanId, uint256 poolId, address borrower, uint256 principal, uint256 interest);
    event Repaid(uint256 loanId, address borrower);
    event Liquidated(uint256 loanId, address liquidator);

    constructor() Ownable(msg.sender) {}

    function addCollateralType(address token, uint256 priceScale) external onlyOwner {
        whitelistedCollateral[token] = true;
        collateralPrices[token] = priceScale; // 1 token = priceScale native wei
    }

    function createPool(uint256 duration, uint256 fixedAPY, string memory tokenName, string memory tokenSymbol) external onlyOwner {
        poolCounter++;
        ReceiptToken rt = new ReceiptToken(tokenName, tokenSymbol);
        
        pools[poolCounter] = Pool({
            duration: duration,
            fixedAPY: fixedAPY,
            totalLiquidity: 0,
            totalBorrowed: 0,
            receiptToken: address(rt)
        });
        
        emit PoolCreated(poolCounter, duration, fixedAPY, address(rt));
    }

    function deposit(uint256 poolId) external payable {
        require(poolId > 0 && poolId <= poolCounter, "Invalid pool");
        require(msg.value > 0, "Zero deposit");

        Pool storage pool = pools[poolId];
        pool.totalLiquidity += msg.value;

        ReceiptToken(pool.receiptToken).mint(msg.sender, msg.value);
        emit Deposited(poolId, msg.sender, msg.value);
    }

    function withdraw(uint256 poolId, uint256 amount) external {
        require(poolId > 0 && poolId <= poolCounter, "Invalid pool");
        Pool storage pool = pools[poolId];
        
        uint256 available = pool.totalLiquidity - pool.totalBorrowed;
        require(available >= amount, "Insufficient liquidity");

        ReceiptToken(pool.receiptToken).burn(msg.sender, amount);
        pool.totalLiquidity -= amount;
        
        payable(msg.sender).transfer(amount);
    }

    function borrow(uint256 poolId, address collateralToken, uint256 collateralAmount, uint256 borrowAmount) external {
        require(poolId > 0 && poolId <= poolCounter, "Invalid pool");
        require(whitelistedCollateral[collateralToken], "Collateral not whitelisted");
        
        Pool storage pool = pools[poolId];
        uint256 available = pool.totalLiquidity - pool.totalBorrowed;
        require(available >= borrowAmount, "Insufficient liquidity in pool");

        // Calculate collateral value in native token
        uint256 collatValue = (collateralAmount * collateralPrices[collateralToken]) / 1 ether;
        uint256 requiredCollat = (borrowAmount * COLLATERAL_RATIO) / 100;
        require(collatValue >= requiredCollat, "Insufficient collateral");

        // Transfer collateral
        IERC20(collateralToken).transferFrom(msg.sender, address(this), collateralAmount);

        // Calculate interest: Simple interest for the term
        // interest = principal * APY * (duration / 365 days)
        uint256 interestAmount = (borrowAmount * pool.fixedAPY * pool.duration) / (10000 * 365 days);

        loanCounter++;
        loans[loanCounter] = Loan({
            poolId: poolId,
            borrower: msg.sender,
            principal: borrowAmount,
            interestAmount: interestAmount,
            maturityDate: block.timestamp + pool.duration,
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            isActive: true
        });

        pool.totalBorrowed += borrowAmount;
        
        payable(msg.sender).transfer(borrowAmount);
        emit Borrowed(loanCounter, poolId, msg.sender, borrowAmount, interestAmount);
    }

    function repay(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        require(loan.isActive, "Loan not active");
        
        uint256 totalDue = loan.principal + loan.interestAmount;
        require(msg.value == totalDue, "Must pay exact principal + interest");

        loan.isActive = false;
        
        Pool storage pool = pools[loan.poolId];
        pool.totalBorrowed -= loan.principal;
        pool.totalLiquidity += loan.interestAmount; // interest goes to the pool

        // Return collateral
        IERC20(loan.collateralToken).transfer(loan.borrower, loan.collateralAmount);

        emit Repaid(loanId, loan.borrower);
    }

    function liquidate(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        require(loan.isActive, "Loan not active");

        bool canLiquidate = false;
        
        if (block.timestamp > loan.maturityDate) {
            canLiquidate = true;
        } else {
            uint256 collatValue = (loan.collateralAmount * collateralPrices[loan.collateralToken]) / 1 ether;
            uint256 totalDue = loan.principal + loan.interestAmount;
            uint256 currentRatio = (collatValue * 100) / totalDue;
            if (currentRatio < LIQUIDATION_THRESHOLD) {
                canLiquidate = true;
            }
        }

        require(canLiquidate, "Cannot be liquidated");

        loan.isActive = false;
        
        Pool storage pool = pools[loan.poolId];
        pool.totalBorrowed -= loan.principal;

        // Transfer collateral to liquidator
        IERC20(loan.collateralToken).transfer(msg.sender, loan.collateralAmount);

        emit Liquidated(loanId, msg.sender);
    }

    // Admin helper
    function setCollateralPrice(address token, uint256 price) external onlyOwner {
        collateralPrices[token] = price;
    }
}
