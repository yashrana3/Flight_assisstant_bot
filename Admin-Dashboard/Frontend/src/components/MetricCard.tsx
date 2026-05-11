"use client";

import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
    title: string;
    value: string | number;
    change?: number;
    icon: LucideIcon;
    iconColor?: string;
    iconBgColor?: string;
}

export function MetricCard({
    title,
    value,
    change,
    icon: Icon,
    iconColor = "text-blue-600",
    iconBgColor = "bg-blue-100"
}: MetricCardProps) {
    const isPositive = change && change > 0;
    const isNegative = change && change < 0;

    return (
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <p className="text-sm text-gray-600 mb-1">{title}</p>
                    <h3 className="text-2xl font-semibold text-gray-900 mb-2">{value}</h3>
                    {change !== undefined && (
                        <div className="flex items-center gap-1">
                            {isPositive && <TrendingUp className="w-4 h-4 text-green-600" />}
                            {isNegative && <TrendingDown className="w-4 h-4 text-red-600" />}
                            <span
                                className={`text-sm font-medium ${isPositive ? "text-green-600" : isNegative ? "text-red-600" : "text-gray-600"
                                    }`}
                            >
                                {isPositive ? "+" : ""}{change}%
                            </span>
                            <span className="text-sm text-gray-500">vs last period</span>
                        </div>
                    )}
                </div>
                <div className={`${iconBgColor} p-3 rounded-lg`}>
                    <Icon className={`w-6 h-6 ${iconColor}`} />
                </div>
            </div>
        </div>
    );
}
