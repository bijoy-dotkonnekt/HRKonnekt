"use client";
import { createContext, useContext } from "react";

export const RoleCtx = createContext({ emp: 10, role: "employee", name: "Priya Sharma" });
export const useRole = () => useContext(RoleCtx);
