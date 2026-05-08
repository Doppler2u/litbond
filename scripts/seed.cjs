const { ethers } = require("hardhat");

async function main() {
  const contractAddress = "0x644FFeEF6ac677916e10bAcc4Cec0f8C78D7e978";
  
  console.log("Connecting to contract at:", contractAddress);
  const LitWorkEscrow = await ethers.getContractFactory("LitWorkEscrow");
  const escrow = LitWorkEscrow.attach(contractAddress);

  const jobsToCreate = [
    {
      desc: "Smart Contract Audit for DEX",
      milestoneDesc: "Review core logic and provide PDF report",
      amount: ethers.parseEther("0.001")
    },
    {
      desc: "React Native Mobile App UI",
      milestoneDesc: "Deliver Figma designs for 5 main screens",
      amount: ethers.parseEther("0.0005")
    },
    {
      desc: "Write LitVM Documentation",
      milestoneDesc: "Write 3 pages of markdown tutorials",
      amount: ethers.parseEther("0.0002")
    }
  ];

  console.log("Seeding testnet with dummy jobs...");

  for (let i = 0; i < jobsToCreate.length; i++) {
    const job = jobsToCreate[i];
    console.log(`Creating job ${i + 1}: ${job.desc}`);
    const tx = await escrow.createJob([job.amount], [job.milestoneDesc], { value: job.amount });
    await tx.wait();
    console.log(`Job ${i + 1} created successfully!`);
  }

  console.log("Seeding complete! Switch to a different MetaMask account to see these in the 'Find Work' section.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
