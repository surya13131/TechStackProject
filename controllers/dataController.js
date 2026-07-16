import mongoose from "mongoose";
import Record from "../models/Record.js";

// ==========================================
// Fetch all records for the dashboard
// ==========================================
export const getRecords = async (req, res) => {
  try {
    // PERFORMANCE UPGRADE: .lean() returns plain JSON
    const records = await Record.find().sort({ createdAt: -1 }).lean();
    res.status(200).json(records);
  } catch (err) {
    console.error("❌ Error fetching records:", err);
    res.status(500).json({ error: "Server error while fetching records." });
  }
};

// ==========================================
// Update a specific record (Triggered by Edit)
// ==========================================
export const updateRecord = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Validate the MongoDB ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid record ID format." });
    }

    // 2. Destructure ONLY the fields allowed for update
    const { 
      name, 
      email, 
      phone, 
      location, 
      college, 
      degree, 
      specialization,
      platform 
    } = req.body;

    const secureUpdate = { 
      name, 
      email, 
      phone, 
      location, 
      college, 
      degree, 
      specialization,
      platform 
    };

    // 3. Perform the update in MongoDB
    const updated = await Record.findByIdAndUpdate(
      id,
      { $set: secureUpdate },
      { new: true, runValidators: true } 
    ).lean(); 
    
    if (!updated) {
      return res.status(404).json({ error: "Record not found." });
    }

    res.status(200).json(updated);
  } catch (err) {
    console.error(`❌ Error updating record ${req.params.id}:`, err);
    res.status(500).json({ error: "Server error while updating the record." });
  }
};

// ==========================================
// Delete a specific record (Triggered by Delete button)
// ==========================================
export const deleteRecord = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid record ID format." });
    }

    const deleted = await Record.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({ error: "Record not found or already deleted." });
    }

    res.status(200).json({ 
      message: "Record deleted successfully.",
      deletedId: id 
    });
  } catch (err) {
    console.error(`❌ Error deleting record ${req.params.id}:`, err);
    res.status(500).json({ error: "Server error while deleting the record." });
  }
};