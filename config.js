// Replace this after deployment.
const CONTRACT_ADDRESS = "0xE0A2014abc746761ac3E485903e6C12c2E32A6ee";

// Keep this ABI in sync with BlockBidIPL.sol.
const CONTRACT_ABI = [
  "function owner() view returns (address)",
  "function registerTeam(string teamName)",
  "function activateAuction(uint256 playerId, uint256 durationSeconds)",
  "function placeBid(uint256 playerId) payable",
  "function endAuction(uint256 playerId)",
  "function getPlayers() view returns ((uint256 id,string name,uint256 basePrice,string imageUrl,uint8 status,uint256 highestBid,address highestBidder,address soldTo,uint256 auctionStartTime,uint256 auctionEndTime)[])",
  "function getTeam(address teamWallet) view returns ((string name,bool isRegistered,uint256 totalSpent,uint256[] playersBought))",
  "event TeamRegistered(address indexed teamWallet, string teamName)",
  "event AuctionActivated(uint256 indexed playerId, uint256 startTime, uint256 endTime)",
  "event NewBid(uint256 indexed playerId, address indexed bidder, uint256 bidAmount)",
  "event AuctionEnded(uint256 indexed playerId, address indexed winner, uint256 winningBid)"
];
