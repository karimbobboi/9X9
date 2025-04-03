import React, { useState } from 'react';
import {Form, Stack} from 'react-bootstrap';
import "bootstrap/dist/css/bootstrap.min.css";
import './App.css';
import './utils';
import JSZip from 'jszip';

function App() {
  const [manifest, setManifest] = useState<string>('');
  const [zipTiles, setZipTiles] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [saveToPDF, setSaveToPDF] = useState<boolean>(true);
  const [image_resolution, setResolution] = useState<number>(9);
  const [consoleMessages, setConsoleMessages] = useState<string[]>([
    'WELCOME']);

  const updateError = (message: string) => {
    setConsoleMessages(prev => [...prev, `ERROR: ${message}`]);
  };

  const updateProgress = (message: string) => {
    setConsoleMessages(prev => [...prev, message]);
  };

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    if (manifest && isValidUrl(manifest)) {
      setIsLoading(true);
      await download_IIIF_document();
      setIsLoading(false);
    } else {
      updateError("Invalid IIIF Manifest URL.");
    }
  };
  
  const download_IIIF_document = async () => {
    try {
      updateProgress("Fetching IIIF manifest...");
      const iiif_manifest = await fetchIIIF();
      
      if (!iiif_manifest) {
        updateError("Failed to retrieve manifest");
        return;
      }
      
      updateProgress("Extracting image information...");
      const canvases = await extractImageInfo(iiif_manifest);
      
      if (!canvases || canvases.length === 0) {
        updateError("No valid canvases found in manifest");
        return;
      }
      
      updateProgress("Processing image tiles...");
      const tiles_info = await extractTiles(canvases);

      if (!tiles_info || tiles_info.length === 0) {
        updateError("No valid tiles found");
        return;
      }

      for (let i = 0; i < tiles_info.length; i++) {
        const tileGroup = tiles_info[i];
        if (tileGroup && tileGroup.length > 0) {
          updateProgress(`Combining image ${i+1} of ${tiles_info.length}...`);
          const { max_width, max_height } = tileGroup[0];
          await combineTiles(tileGroup, max_width, max_height, i+1, tiles_info.length);
          
          if (zipTiles) {
            updateProgress(`Creating ZIP for image ${i+1}...`);
            await download_all_tiles(tileGroup, i+1);
          }
        }
      }
      
      updateProgress("All images processed successfully!");
    } catch (err: any) {
      updateError(`Processing error: ${err.message}`);
    }
  };

  const fetchIIIF = async () => {
    const manifest_valid = isValidUrl(manifest);
    if(!manifest_valid) return null;

    try {
      const response = await fetch(manifest);
      if (!response.ok) throw new Error(`Could not fetch manifest ${response.status}`);

      const data = await response.json();
      return data;
    } catch (err: any) {
      updateError(`Error: ${err.message}`);
      return null;
    }
  };

  const extractTiles = async (canvases: any[]) => {    
    if(!canvases || canvases.length === 0){
      updateError("No valid canvases to extract tiles from");
      return null;
    }

    const image_urls = canvases.map((canvas) => {      
      const w: number = canvas.tile_w;
      const h: number = canvas.tile_h;
      const max_width: number = canvas.max_width;
      const max_height: number = canvas.max_height;

      let tile_image_urls: any[] = [];
      for(let i = 0; i < Math.ceil(max_width/w); i++){
        for(let j = 0; j < Math.ceil(max_height/h); j++){
          let x: number = w * i;
          let y: number = h * j;

          const tile_w = Math.min(w, max_width - x);
          const tile_h = Math.min(h, max_height - y);

          const tile_link: string = `${canvas.base_url}/${x},${y},${tile_w},${tile_h}/full/0/default.jpg`;
          tile_image_urls.push({
            "url": tile_link, 
            x, y, 
            width: tile_w,
            height: tile_h,
            max_width, max_height
          });
        }
      }

      return tile_image_urls;
    });
    
    return image_urls;
  };

  const combineTiles = async (tiles: { url: string; x: number; y: number; width: number; height: number }[], 
                              width: number, height: number, imageNum: number, totalImages: number) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
  
      if (!ctx) throw new Error("Could not get canvas context");
  
      canvas.width = width;
      canvas.height = height;
      
      let loadedCount = 1;
      const totalTiles = tiles.length;
      
      for (const tile of tiles) {
        try {
          updateProgress(`Combining image ${imageNum} of ${totalImages}: loading tile ${loadedCount}/${totalTiles}`);
          loadedCount++;
          
          await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            
            // Set timeout to prevent hanging on problematic tiles
            const timeoutId = setTimeout(() => {
              console.warn(`Tile load timeout: ${tile.url}`);
              resolve(null); // Continue even if this tile fails
            }, 10000); // 10 second timeout
            
            img.onload = () => {
              clearTimeout(timeoutId);
              ctx.drawImage(img, tile.x, tile.y);
              resolve(null);
            };
            
            img.onerror = (e) => {
              clearTimeout(timeoutId);
              console.error(`Failed to load image at ${tile.url}:`, e);
              resolve(null); // Continue even if this tile fails
            };
            
            img.src = tile.url;
          });
        } catch (error) {
          console.error(`Error processing tile ${tile.url}:`, error);
        }
      }
      
      const resolution = (image_resolution && image_resolution > 0 && image_resolution < 10) ? (image_resolution / 10) : 0.9;
      const finalImage = canvas.toDataURL("image/jpeg", resolution);
      const link = document.createElement("a");
      link.href = finalImage;
      link.download = `combined_image_${imageNum}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      return true;
    } catch (error) {
      console.error("Error combining tiles:", error);
      updateError(`Failed to combine tiles for image ${imageNum}: ${error}`);
      return false;
    }
  };

  const download_all_tiles = async (tile_urls: any[], imageNum: number) => {
    try {
      const zip = JSZip();
      let loadedCount = 1;
      const totalTiles = tile_urls.length;
      
      for (const tile_obj of tile_urls) {
        try {
          updateProgress(`Zipping image ${imageNum}: processing tile ${loadedCount}/${totalTiles}`);
          
          const response = await fetch(tile_obj.url);
          if (!response.ok) {
            console.log(`Failed to fetch tile ${loadedCount}: ${response.status}`);
            continue;
          }
    
          const blob = await response.blob();
          const fileName = `image${imageNum}_tile_${loadedCount}.jpg`;
    
          zip.file(fileName, blob);
        } catch (err) {
          console.log(`Error processing tile ${loadedCount} for zip:`, err);
        }
      }
  
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(zipBlob);
      link.download = `tiles_image_${imageNum}.zip`;
      document.body.appendChild(link);
      link.click();
  
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      
      return true;
    } catch (error) {
      console.log("Error creating zip:", error);
      updateError(`Failed to create zip for image ${imageNum}: ${error}`);
      return false;
    }
  };

  const extractImageInfo = async (manifest: any) => {
    if(!manifest?.sequences?.[0]?.canvases) {
      updateError("Invalid manifest structure: missing sequences or canvases");
      return null;
    }
    
    try {
      console.log("Extracting relevant info from manifest...");
      const all_canvases = manifest.sequences[0].canvases.map((canvas: any) => {
        try {
          if (!canvas?.images?.[0]?.resource) {
            console.log("Invalid canvas structure", canvas);
            return null;
          }
          
          let image_url = canvas.images[0].resource["@id"];
          if (Array.isArray(image_url)) {
            image_url = image_url[0];
          }
          
          let base_url = canvas.images[0].resource.service["@id"];
          let max_width = canvas.width; 
          let max_height = canvas.height;

          let tile_w, tile_h;
          const service = canvas.images[0].resource.service;
          
          if (service.tiles && Array.isArray(service.tiles) && service.tiles.length > 0) {
            tile_w = service.tiles[0].width;
            tile_h = service.tiles[0].height || tile_w;
          } else if (service.profile?.contains?.indexOf("sizeByH") >= 0) {
            // Fallback to use a reasonable tile size if not specified
            tile_w = 1024;
            tile_h = 1024;
          } else {
            // Another fallback
            tile_w = 512;
            tile_h = 512;
          }

          return {
            base_url,
            image_url,
            tile_w, tile_h,
            max_width, max_height
          };
        } catch (err) {
          console.log("Error processing canvas:", err);
          return null;
        }
      });

      return all_canvases;
    } catch (err) {
      console.error("Error extracting image info:", err);
      updateError(`Failed to extract image info: ${err}`);
      return null;
    }
  };

  const handleRange = (event: React.ChangeEvent<HTMLInputElement >) => {
    const resoultion = event.currentTarget.value;
    if(resoultion)
      setResolution(parseInt(resoultion));
  };

  return (
    <main 
  className="App d-flex flex-column justify-content-center align-items-center vh-100"
  style={{
    backgroundColor: '#0A0A0A',
    fontFamily: `"Cascadia Code", monospace`,
  }}>
  <div className="p-3 rounded d-flex flex-column"
    style={{
      backgroundColor: '#2659CF',
      opacity: '0.9',
      width: '30vw',
      minWidth: '380px',
      height: '75vh',
      minHeight: '507px',
      borderWidth: '1.5px',       
      borderColor: '#537DDF',
      borderStyle: 'solid',
    }}
  >            
      <Form onSubmit={handleSubmit} 
        className="mx-auto py-3 flex-shrink-0 w-100">
        <Form.Group className="mb-3 w-100">
          <Form.Control 
            type="text" 
            id="urlField"
            className='rounded border-dark'
            placeholder="Enter IIIF manifest URL" 
            value={manifest}
            onChange={(event) => setManifest(event?.target.value)}
            disabled={isLoading}
            style={{
              backgroundColor: '#44074B',
              color: 'white',
              fontSize: '1rem',
              boxShadow: '0px 0px 30px 2px #44074B',
              opacity: `${manifest.length > 0 ? '1' : '0.9'}`
            }}
          />
        </Form.Group>

        <button 
          type="submit" 
          className="btn btn-transparent px-2 py-0 download-btn" 
          disabled={isLoading}
          style={{
            color: '#CCC900'
          }}
        >
          <i className="bi bi-box-arrow-down fs-3"></i>
        </button>

        {/* <hr className='mb-2 border-2' /> */}
        
        
        <Stack gap={1} className='mt-4' style={{fontSize: '0.9rem'}}>  
          <Form.Group className="text-light d-flex align-items-center">
            <Form.Label className='fw-bold'>DOWNLOAD INDIVIDUAL TILE:</Form.Label>
            <Form.Check
              type="checkbox"
              checked={zipTiles}
              onChange={(e) => setZipTiles(e.target.checked)}
              className='ms-auto mb-2'
            />
          </Form.Group>

          <Form.Group className="text-light d-flex align-items-center">
            <Form.Label className='fw-bold'>SAVE AS:</Form.Label>
            <div className='ms-auto mb-2 d-flex'>
              <Form.Check
                type="radio"
                checked={saveToPDF}
                label="PDF"
                onChange={(e) => setSaveToPDF(e.target.checked)}
                className='me-3'
                style={{
                  color: `${saveToPDF ? '#FFFB00' : '#D85A99'}`
                }}
              />

              <Form.Check
                type="radio"
                checked={!saveToPDF}
                label="JPG"
                onChange={(e) => setSaveToPDF(!(e.target.checked))}
                className=''
                style={{
                  color: `${!saveToPDF ? '#FFFB00' : '#D85A99'}`
                }}
              />
            </div>
          </Form.Group>
          
          <Form.Group className="text-light text-start">
            <Form.Label className='fw-bold'>OUTPUT DIRECTORY:</Form.Label>
            <div className="input-group custom-file-button">
              <input type="file" className="form-control border-dark" id="inputGroupFile"
              style={{
                backgroundColor: '#2659CF'
              }}
              />
            </div>
          </Form.Group>

          <Form.Group className="text-light text-start mt-1">
            <div className='d-flex'>
              <Form.Label className='fw-bold'>SET IMAGE RESOLUTION:</Form.Label>
              <Form.Label className='fw-bold ms-auto' style={{color: '#CCC900'}}>{image_resolution}</Form.Label>
            </div>
            <Stack direction='horizontal' className='my-0' gap={2}>
              <Form.Label className='fw-bold'
                style={{fontSize: '0.8rem'}}
              >
                1
              </Form.Label>
              <input type="range" className="form-range mb-2" min="1" max="9" defaultValue={image_resolution} onChange={handleRange}/>
              <Form.Label className='fw-bold'
                style={{fontSize: '0.8rem'}}
              >
                9
              </Form.Label>
            </Stack>
          </Form.Group>
        </Stack>
      </Form>

      <div 
        className='px-2 py-1 rounded text-start overflow-y-scroll flex-grow-1' 
        style={{
          backgroundColor: '#204AAC',
          color: '#FFFB00',
          fontSize: '0.8rem',
          width: '100%',
          borderWidth: '1.5px',       
          borderColor: '#537DDF',
          borderStyle: 'solid',
          scrollbarWidth: 'none'
        }}
      >
        {consoleMessages.map((msg, index) => (
          <p key={index} style={{ 
            color: msg.startsWith('ERROR:') ? '#FF5555' : '#FFFB00',
            margin: '4px 0'
          }}>
            {msg}
          </p>
        ))}
      </div>
      
    </div>
    </main>
  );
}

export default App;