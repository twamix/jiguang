import React, { useState, useEffect } from 'react';
import { NOISE_BASE64 } from '@/lib/utils';
import { getUploadUrl } from '@/lib/upload-url';

interface AuroraBackgroundProps {
    isDarkMode: boolean;
    layoutSettings: any;
}

export function AuroraBackground({ isDarkMode, layoutSettings }: AuroraBackgroundProps) {
    const [loadedUrl, setLoadedUrl] = useState<string | undefined>(undefined);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const url = layoutSettings?.bgUrl;
        if (!url) {
            setLoadedUrl(undefined);
            setIsLoaded(false);
            return;
        }

        let cancelled = false;
        const image = new Image();
        image.decoding = 'async';
        image.fetchPriority = 'high';
        image.onload = () => {
            if (cancelled) return;
            // 预加载成功后再切换，加载期间继续显示上一张壁纸。
            setLoadedUrl(url);
            setIsLoaded(true);
        };
        image.src = getUploadUrl(url);

        return () => {
            cancelled = true;
            image.onload = null;
        };
    }, [layoutSettings?.bgUrl]);

    // Default Aurora Layer (Always rendered as base)
    const defaultAurora = (
        <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
            <div
                className={`absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-indigo-600/15 rounded-full blur-[120px] animate-slow-spin ${isDarkMode ? 'opacity-90' : 'opacity-50'}`} />
            <div
                className={`absolute bottom-[-10%] right-[-20%] w-[60%] h-[60%] bg-cyan-500/15 rounded-full blur-[120px] animate-slow-pulse ${isDarkMode ? 'opacity-90' : 'opacity-50'}`} />
            <div className="absolute inset-0 opacity-[0.08] brightness-100 contrast-150 mix-blend-overlay"
                style={{ backgroundImage: `url("${NOISE_BASE64}")` }}></div>
        </div>
    );

    if (layoutSettings?.bgEnabled) {
        // Mode 1: Pure Color
        if (layoutSettings.bgType === 'color') {
            return (
                <div
                    className="fixed inset-0 z-0 pointer-events-none transition-colors duration-500"
                    style={{ backgroundColor: layoutSettings.bgColor || '#F8FAFC' }}
                />
            );
        }

        // Mode 2: Custom/Bing/Network Image
        if (layoutSettings?.bgUrl && loadedUrl) {
            const isCustom = layoutSettings.bgType === 'custom' || layoutSettings.bgType === 'network';
            const scale = isCustom ? (layoutSettings.bgScale || 100) / 100 : 1;
            const bgX = isCustom ? (layoutSettings.bgX ?? 50) : 50;
            const bgY = isCustom ? (layoutSettings.bgY ?? 50) : 50;

            return (
                <>
                    {defaultAurora}
                    <div className={`fixed inset-0 z-0 pointer-events-none overflow-hidden transition-opacity duration-700 ease-in-out ${isLoaded ? 'opacity-100' : 'opacity-0'}`}>
                        <img
                            src={getUploadUrl(loadedUrl)}
                            alt="Background"
                            className="absolute inset-0 w-full h-full"
                            style={{
                                objectFit: 'cover',
                                objectPosition: `${bgX}% ${bgY}%`,
                                transform: `scale(${scale})`,
                            }}
                            fetchPriority="high"
                            decoding="async"
                        />
                        <div
                            className="absolute inset-0 bg-black transition-opacity duration-300"
                            style={{ opacity: (layoutSettings.bgOpacity ?? 40) / 100 }}
                        />
                        <div className="absolute inset-0 opacity-[0.05] mix-blend-overlay pointer-events-none"
                            style={{ backgroundImage: `url("${NOISE_BASE64}")` }}></div>
                    </div>
                </>
            );
        }
    }

    // Default Aurora Mode
    return defaultAurora;
}
