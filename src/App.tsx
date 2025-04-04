import React, { useState, useEffect, useRef } from 'react';
import {Form, Stack} from 'react-bootstrap';
import "bootstrap/dist/css/bootstrap.min.css";
import './App.css';
import JSZip from 'jszip';
import jsPDF from 'jspdf';

function App() {
  const [manifest, setManifest] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [saveToPDF, setSaveToPDF] = useState<boolean>(true);
  const [image_resolution, setResolution] = useState<number>(6);
  const [consoleMessages, setConsoleMessages] = useState<string[]>(
    [
      'IIIF DOWNLOADER',
      '------------------------',
      'WELCOME!',
      '',
      'INSTRUCTIONS:',
      '1. PASTE A VALID IIIF MANIFEST URL',
      '2. CHOOSE OUTPUT FORMAT (PDF/ZIP)',
      '3. SET A FILENAME',
      '4. ADJUST IMAGE RESOLUTION IF NEEDED (9 best)',
      '5. CLICK DOWNLOAD BUTTON'
    ]
  );
  const consoleContainerRef = useRef<HTMLDivElement>(null);
  const [saveFileName, setSaveFileName] = useState<string>('download')

  useEffect(() => {
    if (consoleContainerRef.current) {
      consoleContainerRef.current.scrollTop = consoleContainerRef.current.scrollHeight;
    }
  }, [consoleMessages]);
  
  const updateError = (message: string) => {
    if (message.includes('\n')) {
      const lines = message.split('\n');
      setConsoleMessages(prev => [...prev, ...lines.map(line => `${line.length > 0 ? 'ERROR: ' : '‎'}${line}`)]);
    } else {
      setConsoleMessages(prev => [...prev, `ERROR: ${message}`]);
    }
  };
  
  const updateProgress = (message: string) => {
    if (message.includes('\n')) {
      const lines = message.split('\n');
      setConsoleMessages(prev => [...prev, ...lines.map(line => `${line.length > 0 ? line : '‎'}`)]);
    } else {
      setConsoleMessages(prev => [...prev, message]);
    }
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

    if(saveFileName.length < 1){
      updateError("PLEASE ENTER A FILENAME");
      return;
    }
    
    if (manifest && isValidUrl(manifest)) {
      setIsLoading(true);
      await download_IIIF_document();
      setIsLoading(false);
    } else {
      updateError("Invalid IIIF Manifest URL");
    }
  };
  
  const download_IIIF_document = async () => {
    try {
      updateProgress("\nFetching IIIF manifest...");
      const iiif_manifest = await fetchIIIF();
      console.log(iiif_manifest);
      
      if (!iiif_manifest) {
        updateError("Failed to retrieve manifest");
        return;
      }
      
      updateProgress("MANIFEST LOADED");
      updateProgress("TITLE: " + iiif_manifest.label);
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

      await download_all_images(tiles_info);
      
      
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

  const combineTiles = async (tiles: { url: string; x: number; y: number; width: number; height: number }[], width: number, height: number) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
  
      if (!ctx) throw new Error("Could not get canvas context");
  
      canvas.width = width;
      canvas.height = height;
      
      for (const tile of tiles) {
        try {
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
      return finalImage;
    } catch (error) {
      console.error("Error combining tiles:", error);
      return null;
    }
  };

  const download_all_images = async (images: any[]) => {
    let image_urls = [];
    for (let i = 0; i < images.length; i++) {
      const tileGroup = images[i];
      if (tileGroup && tileGroup.length > 0) {
        updateProgress(`Combining image ${i+1} of ${images.length}...`);
        const { max_width, max_height } = tileGroup[0];
        const image = await combineTiles(tileGroup, max_width, max_height);
        if(!image) updateError(`Failed to combine tiles for image ${i+1}.}`);
        image_urls.push(image);
      }
    }
    
    if(saveToPDF){
      await create_pdf_from_images(image_urls);
    }
    
    else {
      await create_zip_from_images(image_urls);
    }
  };

  const create_pdf_from_images = async (image_urls: any[]) => {
    try {
      const pdf = new jsPDF();
      let firstPage = true;
      let imageCount = 1;
  
      updateProgress(`Creating PDF with ${image_urls.length} images...`);
      for (const image of image_urls) {
        try {
          updateProgress(`Processing image ${imageCount}`);
          
          if (image) {
            const imgProps = pdf.getImageProperties(image);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            
            if (!firstPage) {
              pdf.addPage([pdfWidth, pdfHeight]);
            } else {
              pdf.deletePage(1);
              pdf.addPage([pdfWidth, pdfHeight]);
              firstPage = false;
            }
            
            pdf.addImage(image, 'JPEG', 0, 0, pdfWidth, pdfHeight);
          } else {
            updateError(`Image is null and cannot be processed.`);
          }
          imageCount++;
        } catch (err) {
          console.log(`Error processing image ${imageCount} for PDF:`, err);
        }
      }
  
      const pageCount = pdf.internal.pages.length;
      if (pageCount > imageCount - 1) {
        pdf.deletePage(pageCount);
      }
  
      if(saveFileName.includes('.pdf'))
        pdf.save(saveFileName);
      else pdf.save(saveFileName + '.pdf');
  
      updateProgress(`PDF '${saveFileName}' saved successfully.`);
      return true;
    } catch (error) {
      console.log("Error creating PDF:", error);
      updateError(`Failed to create PDF: ${error}`);
      return false;
    }
  };

  const create_zip_from_images = async (image_urls: any[]) => {
    try {
      const zip = new JSZip();
      let imageCount = 1;
      
      updateProgress(`Creating ZIP with ${image_urls.length} images...`);
      for (const dataUrl of image_urls) {
        updateProgress(`Processing image ${imageCount}`);
        try {
          if (!dataUrl) continue;
          
          // Convert base64 to blob
          const byteString = atob(dataUrl.split(',')[1]);
          const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          
          const blob = new Blob([ab], { type: mimeString });
          const fileName = `image${imageCount}.jpg`;
    
          zip.file(fileName, blob);
          imageCount++;
        } catch (err) {
          console.log(`Error processing image ${imageCount}:`, err);
        }
      }
  
      const zipBlob = await zip.generateAsync({ 
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });
      
      const link = document.createElement("a");
      link.href = URL.createObjectURL(zipBlob);

      if(saveFileName.includes('.zip'))
        link.download = saveFileName;
      else 
        link.download = (saveFileName + '.zip');

      document.body.appendChild(link);
      link.click();
  
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      updateProgress(`Zip '${saveFileName}' saved successfully.`);
      return true;
    } catch (error) {
      updateError(`Failed to create output file: ${error}`);
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

  const handleRange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const resolution = event.currentTarget.value;
    if(resolution)
      setResolution(parseInt(resolution));
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
              boxShadow: `0px 0px ${manifest.length > 0 ? '10px' : '20px'} 2px #44074B`,
              opacity: `${isLoading ? '0.9' : '1'}`
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
        
        <Stack gap={1} className='mt-4' style={{fontSize: '0.9rem'}}>  
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
                label="ZIP"
                onChange={(e) => setSaveToPDF(!(e.target.checked))}
                className=''
                style={{
                  color: `${!saveToPDF ? '#FFFB00' : '#D85A99'}`
                }}
              />
            </div>
          </Form.Group>
          
          <Form.Group className="text-light text-start">
            <Form.Label className='fw-bold'>FILENAME:</Form.Label>
            <Form.Control 
              type="text" 
              className=''
              placeholder="No filename chosen" 
              value={saveFileName}
              onChange={(event) => setSaveFileName(event?.target.value)}
              disabled={isLoading}
              style={{
                backgroundColor: '#204AAC',
                color: '#FFFB00',
                borderWidth: '1.5px',       
                borderColor: '#537DDF',
                borderStyle: 'solid',
              }}
            />
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
        ref={consoleContainerRef}
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