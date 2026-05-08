const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Deploy Mock Collateral
  const MockCollateral = await ethers.getContractFactory("MockCollateral");
  const collateral = await MockCollateral.deploy();
  await collateral.waitForDeployment();
  const collateralAddr = await collateral.getAddress();
  console.log("MockCollateral deployed to:", collateralAddr);

  // Deploy LitBond
  const LitBond = await ethers.getContractFactory("LitBond");
  const litBond = await LitBond.deploy();
  await litBond.waitForDeployment();
  const litBondAddr = await litBond.getAddress();
  console.log("LitBond deployed to:", litBondAddr);

  // Configure LitBond
  console.log("Configuring pools and collateral...");
  
  // Add collateral: 1 mWBTC = 100 zkLTC (mock price)
  const priceScale = ethers.parseEther("100");
  await (await litBond.addCollateralType(collateralAddr, priceScale)).wait();

  // Create 7-day pool (5% APY -> 500 basis points)
  await (await litBond.createPool(7 * 24 * 60 * 60, 500, "LitBond 7-Day", "LB7D")).wait();
  
  // Create 30-day pool (8% APY)
  await (await litBond.createPool(30 * 24 * 60 * 60, 800, "LitBond 30-Day", "LB30D")).wait();

  console.log("Deployment and setup complete!");
  
  // Print JSON for frontend
  console.log("--- CONFIG ---");
  console.log(`export const LITBOND_ADDRESS = "${litBondAddr}";`);
  console.log(`export const COLLATERAL_ADDRESS = "${collateralAddr}";`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
